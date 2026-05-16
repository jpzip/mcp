import type { JpzipClient, ZipcodeDict, ZipcodeEntry } from '@jpzip/jpzip';

export interface AddressHit {
  zipcode: string;
  prefecture: string;
  city: string;
  town: string;
  town_note?: string;
}

export interface CityEntry {
  city_code: string;
  city: string;
  city_kana: string;
  city_roma: string;
}

const ZIP_REGEX = /^\d{7}$/;

function normalizeZipcode(input: string): string | null {
  const stripped = input.replace(/[-ー\s]/g, '');
  return ZIP_REGEX.test(stripped) ? stripped : null;
}

export async function lookupZipcode(
  client: JpzipClient,
  rawZipcode: string,
): Promise<{ zipcode: string; entry: ZipcodeEntry } | { error: string }> {
  const zipcode = normalizeZipcode(rawZipcode);
  if (!zipcode) {
    return { error: `Invalid zipcode: ${JSON.stringify(rawZipcode)}. Expected 7 digits (hyphens allowed).` };
  }
  const entry = await client.lookup(zipcode);
  if (!entry) return { error: `No entry found for zipcode ${zipcode}.` };
  return { zipcode, entry };
}

/**
 * Cache the merged full-dataset promise for the lifetime of this MCP process,
 * so repeated address/city queries within one Claude session reuse the same
 * 120k-entry object instead of re-running lookupAll()'s 10-way merge each time.
 * The underlying jpzip SDK L1 cache already covers the network side.
 */
let fullDatasetPromise: Promise<ZipcodeDict> | null = null;
function getFullDataset(client: JpzipClient): Promise<ZipcodeDict> {
  if (fullDatasetPromise === null) {
    fullDatasetPromise = client.lookupAll().catch((err) => {
      // allow retry on next call after a failure
      fullDatasetPromise = null;
      throw err;
    });
  }
  return fullDatasetPromise;
}

export async function searchByAddress(
  client: JpzipClient,
  query: string,
  limit = 20,
): Promise<AddressHit[]> {
  const q = query.trim();
  if (!q) return [];
  const dict = await getFullDataset(client);
  // Match against three separate haystacks (kanji / kana / romaji) instead of
  // concatenating all three, so "中区本町" matches even though city and town
  // are different fields. Strip whitespace so user input like "横浜市中区本町"
  // matches the spaced romaji ("Yokohama Shi Naka Ku" + "Honcho").
  const stripWS = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
  const needle = stripWS(q);
  const hits: AddressHit[] = [];
  for (const [zipcode, entry] of Object.entries(dict)) {
    const kanjiPref = `${entry.prefecture}${entry.city}`;
    const kanaPref = `${entry.prefecture_kana}${entry.city_kana}`;
    const romaPref = `${entry.prefecture_roma}${entry.city_roma}`;
    for (const town of entry.towns) {
      const kanjiHay = stripWS(`${kanjiPref}${town.town}`);
      const kanaHay = stripWS(`${kanaPref}${town.kana}`);
      const romaHay = stripWS(`${romaPref}${town.roma}`);
      if (kanjiHay.includes(needle) || kanaHay.includes(needle) || romaHay.includes(needle)) {
        hits.push({
          zipcode,
          prefecture: entry.prefecture,
          city: entry.city,
          town: town.town,
          ...(town.note ? { town_note: town.note } : {}),
        });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

export async function listCitiesInPrefecture(
  client: JpzipClient,
  prefecture: string,
): Promise<CityEntry[] | { error: string }> {
  const q = prefecture.trim().toLowerCase();
  if (!q) return { error: 'prefecture must be a non-empty string.' };
  const dict = await getFullDataset(client);
  const seen = new Map<string, CityEntry>();
  let matched = false;
  for (const entry of Object.values(dict)) {
    const hay = `${entry.prefecture} ${entry.prefecture_kana} ${entry.prefecture_roma}`.toLowerCase();
    if (!hay.includes(q)) continue;
    matched = true;
    if (!seen.has(entry.city_code)) {
      seen.set(entry.city_code, {
        city_code: entry.city_code,
        city: entry.city,
        city_kana: entry.city_kana,
        city_roma: entry.city_roma,
      });
    }
  }
  if (!matched) return { error: `No prefecture matched ${JSON.stringify(prefecture)}.` };
  return [...seen.values()].sort((a, b) => a.city_code.localeCompare(b.city_code));
}
