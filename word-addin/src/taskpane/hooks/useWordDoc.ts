/* global Word, Office */

/**
 * Office.js helpers for reading/writing the open Word document.
 *
 * The bulk of the file mirrors the upstream `useWordDoc.ts` from the
 * Max reference repo: selection state, formatting, paragraph styles,
 * track-changes mode, accept/reject revisions, and the find-and-replace
 * helper that applies edits with track changes turned on.
 *
 * Trim notes:
 *   - Removed the rich formatting bundle (`applyFormatting`, alignment,
 *     line spacing) — we don't surface formatting toolbars in the
 *     add-in yet. They can be re-added trivially when needed.
 */

// ---------------------------------------------------------------------------
// Document content
// ---------------------------------------------------------------------------

export async function getDocumentText(): Promise<string> {
    return Word.run(async (context) => {
        const body = context.document.body;
        body.load("text");
        await context.sync();
        return body.text ?? "";
    });
}

export type WordSelectionState = {
    text: string;
    isEmpty: boolean;
    length: number;
    /** First 50 chars of the selection, with an ellipsis if truncated. */
    snippet: string;
};

const EMPTY_SELECTION: WordSelectionState = {
    text: "",
    isEmpty: true,
    length: 0,
    snippet: "",
};

function buildSnippet(text: string): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) return "";
    if (collapsed.length <= 50) return collapsed;
    return collapsed.slice(0, 50) + "…";
}

export async function getSelectionState(): Promise<WordSelectionState> {
    try {
        if (typeof Word === "undefined") return EMPTY_SELECTION;
        return await Word.run(async (context) => {
            const sel = context.document.getSelection();
            sel.load("text,isEmpty");
            await context.sync();
            const text = sel.text ?? "";
            const isEmpty = sel.isEmpty || text.length === 0;
            if (isEmpty) return EMPTY_SELECTION;
            return {
                text,
                isEmpty: false,
                length: text.length,
                snippet: buildSnippet(text),
            };
        });
    } catch {
        return EMPTY_SELECTION;
    }
}

// ---------------------------------------------------------------------------
// Track changes
// ---------------------------------------------------------------------------

export type TrackChangesMode = "off" | "all" | "mine";

export async function setTrackChangesMode(mode: TrackChangesMode): Promise<void> {
    await Word.run(async (context) => {
        const modeMap: Record<TrackChangesMode, Word.ChangeTrackingMode> = {
            off: Word.ChangeTrackingMode.off,
            all: Word.ChangeTrackingMode.trackAll,
            mine: Word.ChangeTrackingMode.trackMineOnly,
        };
        context.document.changeTrackingMode = modeMap[mode];
        await context.sync();
    });
}

export async function getTrackChangesMode(): Promise<TrackChangesMode> {
    return Word.run(async (context) => {
        context.document.load("changeTrackingMode");
        await context.sync();
        const m = context.document.changeTrackingMode;
        if (m === Word.ChangeTrackingMode.trackAll) return "all";
        if (m === Word.ChangeTrackingMode.trackMineOnly) return "mine";
        return "off";
    });
}

export async function acceptAllChanges(): Promise<{
    ok: boolean;
    count: number;
    fallback?: boolean;
}> {
    try {
        return await Word.run(async (context) => {
            const revisions = context.document.revisions;
            revisions.load("items");
            await context.sync();
            const count = revisions.items.length;
            revisions.items.forEach((r) => r.accept());
            await context.sync();
            return { ok: true, count };
        });
    } catch {
        return { ok: false, count: 0, fallback: true };
    }
}

export async function rejectAllChanges(): Promise<{
    ok: boolean;
    count: number;
    fallback?: boolean;
}> {
    try {
        return await Word.run(async (context) => {
            const revisions = context.document.revisions;
            revisions.load("items");
            await context.sync();
            const count = revisions.items.length;
            // Reverse iteration preserves positions while we mutate.
            [...revisions.items].reverse().forEach((r) => r.reject());
            await context.sync();
            return { ok: true, count };
        });
    } catch {
        return { ok: false, count: 0, fallback: true };
    }
}

export async function getRevisionCount(): Promise<number | null> {
    try {
        return await Word.run(async (context) => {
            const revisions = context.document.revisions;
            revisions.load("items");
            await context.sync();
            return revisions.items.length;
        });
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Find & replace with track changes
// ---------------------------------------------------------------------------

export interface EditProposal {
    find: string;
    replace: string;
    reason?: string;
}

export async function applyEditsWithTracking(
    edits: EditProposal[],
): Promise<{ applied: number; notFound: string[] }> {
    let applied = 0;
    const notFound: string[] = [];

    // Word's body.search() caps at 255 chars and won't match across
    // paragraph marks. We mitigate by searching head + tail anchors.
    const ANCHOR_CHARS = 80;
    const SEARCH_LIMIT = 200;

    const splitParagraphs = (s: string) =>
        s
            .split(/[\r\n]+/)
            .map((x) => x.trim())
            .filter((x) => x.length >= 6);
    const clip = (s: string, n: number) =>
        s.length > n ? s.slice(0, n) : s;

    async function findOne(
        context: Word.RequestContext,
        q: string,
    ): Promise<Word.Range | null> {
        if (!q || q.length < 4) return null;
        const r = context.document.body.search(q, {
            matchCase: false,
            matchWholeWord: false,
        });
        r.load("items");
        await context.sync();
        return r.items[0] ?? null;
    }

    for (const edit of edits) {
        try {
            const count = await Word.run(async (context) => {
                context.document.changeTrackingMode =
                    Word.ChangeTrackingMode.trackAll;

                const find = (edit.find ?? "").trim();
                if (!find) return 0;

                const hasLineBreak = /[\r\n]/.test(find);
                if (!hasLineBreak && find.length <= SEARCH_LIMIT) {
                    const direct = await findOne(context, find);
                    if (direct) {
                        direct.insertText(
                            edit.replace,
                            Word.InsertLocation.before,
                        );
                        direct.delete();
                        await context.sync();
                        return 1;
                    }
                }

                const paragraphs = splitParagraphs(find);
                if (paragraphs.length === 0) return 0;
                const head = clip(paragraphs[0], ANCHOR_CHARS);
                const tail = clip(
                    paragraphs[paragraphs.length - 1],
                    ANCHOR_CHARS,
                );

                const headRange = await findOne(context, head);
                if (!headRange) return 0;

                let target: Word.Range = headRange;
                if (paragraphs.length > 1) {
                    const tailRange = await findOne(context, tail);
                    if (tailRange) {
                        try {
                            target = headRange.expandTo(tailRange);
                        } catch {
                            target = headRange;
                        }
                    }
                }

                target.insertText(edit.replace, Word.InsertLocation.before);
                target.delete();
                await context.sync();
                return 1;
            });

            if (count === 0) notFound.push(edit.find);
            else applied += count;
        } catch {
            notFound.push(edit.find);
        }
    }

    return { applied, notFound };
}

export async function getDocumentForContext(maxChars = 40000): Promise<string> {
    return Word.run(async (context) => {
        const body = context.document.body;
        body.load("text");
        await context.sync();
        const text = body.text ?? "";
        if (text.length <= maxChars) return text;
        return text.slice(0, maxChars) + "\n[…document truncated for context…]";
    });
}
