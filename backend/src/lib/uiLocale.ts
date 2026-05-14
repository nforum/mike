import type { Request } from "express";

export type UiLocale = "en" | "hr";

export function parseUiLocale(req: Request): UiLocale {
    const raw = req.headers["x-ui-locale"];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v === "hr" || v === "en") return v;
    return "en";
}

/**
 * Injected into LLM system prompts so outputs match the UI language and
 * regional standard (HR vs SR/BS; international EN vs colloquial AU), with
 * Europe/Zagreb as the primary clock for “today”.
 */
export function localeContextForLlm(locale: UiLocale): string {
    const now = new Date();
    const cet = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Zagreb",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(now);

    if (locale === "hr") {
        return [
            "---",
            "JEZIK SUČELJA (obavezno): Korisnik koristi hrvatski (Hrvatska) u aplikaciji.",
            "Za sva polja koja korisnik vidi u sučelju (sažetak, obrazloženje/reasoning, oznake, naslove stupaca ako nisu citati iz dokumenta) piši isključivo standardnim hrvatskim: hrvatski pravopis i pravna terminologija.",
            "Izbjegavaj srpske, bosanske i crnogorske varijante (npr. izrazito srpske glagolske forme ili vokabular koji nije uobičajen u hrvatskom pravnom diskursu). Ako dokument sadrži drugi jezik, citiraj točno iz dokumenta, ali vlastiti sazdržaj formula na hrvatskom.",
            "Ne miješaj engleski u korisnički tekst osim citata iz dokumenta ili međunarodnih naziva kada je nužno.",
            `Referentno vrijeme (Europe/Zagreb, lokalno CET/CEST): ${cet}.`,
            "---",
        ].join("\n");
    }

    return [
        "---",
        "UI LANGUAGE (required): The application UI is set to English.",
        "Write all user-visible extraction content (summary, reasoning, labels) in clear international English (UK/international professional style). Avoid Australian colloquialisms, British slang, or region-specific spelling unless the source document uses them in a quotation.",
        "When quoting the document, preserve the document’s language and wording.",
        `Reference date/time (Europe/Zagreb): ${cet}.`,
        "---",
    ].join("\n");
}
