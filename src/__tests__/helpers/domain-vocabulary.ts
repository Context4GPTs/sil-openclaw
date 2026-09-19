/**
 * "domain", never "category", as the name of sil's registry concept — a SINGLE source
 * of truth shared by the bundle prose guard (`skill-bundle-contract.integration.test.ts`)
 * and the registered-surface guard (`tools/tool-schema-contract.unit.test.ts`), the same
 * one-module discipline as `per-niche-expert.ts` and `honesty-vocabulary.ts`.
 *
 * A BLANKET forbid on the word was considered and rejected — `honesty-vocabulary.ts`
 * keeps the retired PARAMETER in its backticked form (`` `category` ``) and deliberately
 * leaves the bare word alone, because prose legitimately says "research how the category
 * is bought". So this matches only where `category` takes the registry's OWN words or the
 * possessive: those cannot be the generic English sense.
 */

/**
 * `category` naming what the registry calls a domain — possessive, or taking a word only
 * the registry owns. Deliberately blind to the generic sense ("a shortlist about the
 * category", "the web researches a category"), which is why it can run as a blanket scan.
 */
const CATEGORY_AS_DOMAIN =
  /\bcategor(?:y|ies)'s\b|\bcategor(?:y|ies)\s+(?:path|paths|guide|guides|document|documents|registry|branch|key|keys|spec|specs)\b/gi;

/** The offending contexts (empty ⇒ clean), each with enough text around it to grep for. */
export function categoryAsDomainOffenders(body: string): string[] {
  const offenders: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CATEGORY_AS_DOMAIN.source, CATEGORY_AS_DOMAIN.flags);
  while ((m = re.exec(body)) !== null) {
    offenders.push(
      body
        .slice(Math.max(0, m.index - 30), m.index + m[0].length + 20)
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return offenders;
}
