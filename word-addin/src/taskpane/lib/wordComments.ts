/* global Word */

/**
 * Office.js helpers for inserting Word comments and applying tracked
 * edits with attached rationale comments. Mirrors the upstream Max
 * implementation; the only changes are local imports and our coding
 * conventions.
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/javascript/api/word/word.range#word-word-range-insertcomment-member(1)
 */

import { applyEditsWithTracking, type EditProposal } from "../hooks/useWordDoc";

export type EditMode = "track" | "comments";

const SEARCH_LIMIT = 200;
const ANCHOR_CHARS = 80;

function splitParagraphs(find: string): string[] {
    return find
        .split(/[\r\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 6);
}

function clip(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) : s;
}

async function locateRange(
    context: Word.RequestContext,
    fullFind: string,
): Promise<Word.Range | null> {
    const body = context.document.body;
    const trimmed = fullFind.trim();
    if (!trimmed) return null;

    const findOne = async (q: string): Promise<Word.Range | null> => {
        if (!q || q.length < 4) return null;
        const r = body.search(q, { matchCase: false, matchWholeWord: false });
        r.load("items");
        await context.sync();
        return r.items[0] ?? null;
    };

    const hasLineBreak = /[\r\n]/.test(trimmed);
    if (!hasLineBreak && trimmed.length <= SEARCH_LIMIT) {
        const direct = await findOne(trimmed);
        if (direct) return direct;
    }

    const paragraphs = splitParagraphs(trimmed);
    if (paragraphs.length === 0) return null;

    const headSrc = paragraphs[0];
    const tailSrc = paragraphs[paragraphs.length - 1];
    const head = clip(headSrc, ANCHOR_CHARS);
    const tail = clip(tailSrc, ANCHOR_CHARS);

    if (paragraphs.length === 1) return findOne(head);

    const headRange = await findOne(head);
    if (!headRange) return null;
    const tailRange = await findOne(tail);
    if (!tailRange) return headRange;
    try {
        return headRange.expandTo(tailRange);
    } catch {
        return headRange;
    }
}

export async function insertCommentAtCurrentSelection(
    text: string,
): Promise<void> {
    try {
        await Word.run(async (context) => {
            const sel = context.document.getSelection();
            sel.insertComment(text);
            await context.sync();
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[wordComments] insertCommentAtCurrentSelection failed", err);
        throw err;
    }
}

export async function insertCommentAtRange(
    searchString: string,
    commentText: string,
): Promise<void> {
    try {
        await Word.run(async (context) => {
            const range = await locateRange(context, searchString);
            if (!range) {
                throw new Error(
                    `Could not find anchor text in document: "${
                        searchString.length > 60
                            ? searchString.slice(0, 60) + "…"
                            : searchString
                    }"`,
                );
            }
            range.insertComment(commentText);
            await context.sync();
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[wordComments] insertCommentAtRange failed", err);
        throw err;
    }
}

export async function applyTrackedEdit(
    originalText: string,
    newText: string,
): Promise<void> {
    try {
        const edits: EditProposal[] = [{ find: originalText, replace: newText }];
        const { applied, notFound } = await applyEditsWithTracking(edits);
        if (applied === 0 && notFound.length > 0) {
            throw new Error(
                `Could not find text to replace: "${
                    originalText.length > 60
                        ? originalText.slice(0, 60) + "…"
                        : originalText
                }"`,
            );
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[wordComments] applyTrackedEdit failed", err);
        throw err;
    }
}

/**
 * Replace `edit.find` with `edit.replace` while track changes is enabled,
 * AND attach a Word comment with `edit.reason` (when present) anchored
 * to the inserted range. Reviewers see redline + rationale together.
 *
 * Two-step replacement (insert before + delete) is more reliable on
 * Word for Mac than the single-step `insertText("Replace")` form, which
 * sometimes loses the insertion half.
 */
export async function applyTrackedChangeWithComment(edit: {
    find: string;
    replace: string;
    reason?: string;
}): Promise<{ applied: number; notFound: number }> {
    try {
        return await Word.run(async (context) => {
            context.document.changeTrackingMode =
                Word.ChangeTrackingMode.trackAll;

            const target = await locateRange(context, edit.find);
            if (!target) return { applied: 0, notFound: 1 };

            const inserted = target.insertText(
                edit.replace,
                Word.InsertLocation.before,
            );
            target.delete();

            const reason = (edit.reason ?? "").trim();
            if (reason) {
                inserted.insertComment(`Max: ${reason}`);
            }

            await context.sync();
            return { applied: 1, notFound: 0 };
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[wordComments] applyTrackedChangeWithComment failed", err);
        throw err;
    }
}

export async function applyEditsAsComments(
    edits: EditProposal[],
): Promise<{ applied: number; notFound: string[] }> {
    let applied = 0;
    const notFound: string[] = [];

    for (const edit of edits) {
        try {
            const body = edit.reason
                ? `Max: ${edit.replace}\n\n(${edit.reason})`
                : `Max: ${edit.replace}`;
            await insertCommentAtRange(edit.find, body);
            applied += 1;
        } catch {
            notFound.push(edit.find);
        }
    }

    return { applied, notFound };
}
