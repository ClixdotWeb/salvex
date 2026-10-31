// Match photo files to vehicles for the bulk upload.
//
// A photo belongs to a vehicle when
//   - a folder in its path is named with the vehicle's registration number or claim number
//     (Photos/KL07AB1234/front.jpg, Photos/CLM-2026-0001/IMG_2034.jpg), or
//   - its file name starts with the registration number (or claim number), followed by nothing or a separator
//     (KL07AB1234.jpg, KL-07-AB-1234_2.jpg, KL07AB1234 (3).png), so KL07AB12345.jpg never matches KL07AB1234.
// Spaces, dashes and case are ignored. Photos are ordered by name (1, 2, 10), so the first one is the cover.
// A claim number shared by two vehicles is not used (it would be ambiguous); the registration number still works.
import { sourcePhotoProblem } from '../api/photoPrep';

export const MAX_PHOTOS_PER_VEHICLE = 20;

const norm = (text) => (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isAlnum = (ch) => /[A-Za-z0-9]/.test(ch);

/** Does `stem` start with `key` (ignoring separators), with the key ending at a word boundary? */
function startsWithKey(stem, key) {
  let i = 0;
  let matched = 0;
  while (i < stem.length && matched < key.length) {
    const ch = stem[i];
    if (isAlnum(ch)) {
      if (ch.toUpperCase() !== key[matched]) return false;
      matched += 1;
    }
    i += 1;
  }
  return matched === key.length && (i >= stem.length || !isAlnum(stem[i]));
}

const isImage = (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);

/**
 * @param {File[]} files  chosen files (a folder or several photos)
 * @param {{registration_number: string, claim_number?: string}[]} vehicles  the vehicles in the upload
 * @returns {{ byReg: Map<string, File[]>, unmatched: File[], problems: string[], extra: number }}  byReg is keyed by regKey()
 */
export function matchPhotos(files, vehicles) {
  const keyToReg = new Map();                          // normalised registration or claim number -> registration key
  const claimCount = new Map();
  for (const v of vehicles) {
    const c = norm(v.claim_number);
    if (c) claimCount.set(c, (claimCount.get(c) || 0) + 1);
  }
  for (const v of vehicles) {
    const reg = norm(v.registration_number);
    if (!reg) continue;
    keyToReg.set(reg, reg);
    const c = norm(v.claim_number);
    if (c && claimCount.get(c) === 1 && !keyToReg.has(c)) keyToReg.set(c, reg);
  }
  const keys = [...keyToReg.keys()].sort((a, b) => b.length - a.length);   // longest first
  const byReg = new Map();
  const unmatched = [];
  const problems = [];
  for (const file of files) {
    if (!isImage(file)) continue;                       // Thumbs.db, .DS_Store, notes ...
    const path = (file.webkitRelativePath || file.name).split('/');
    const name = path[path.length - 1];
    const stem = name.replace(/\.[^.]+$/, '');
    let key = path.slice(0, -1).map(norm).reverse().find((folder) => keyToReg.has(folder));
    if (!key) key = keys.find((k) => startsWithKey(stem, k));
    if (!key) { unmatched.push(file); continue; }
    const problem = sourcePhotoProblem(file);
    if (problem) { problems.push(problem); continue; }
    const reg = keyToReg.get(key);
    if (!byReg.has(reg)) byReg.set(reg, []);
    byReg.get(reg).push(file);
  }
  let extra = 0;
  for (const [reg, list] of byReg) {
    list.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
    if (list.length > MAX_PHOTOS_PER_VEHICLE) {
      extra += list.length - MAX_PHOTOS_PER_VEHICLE;
      byReg.set(reg, list.slice(0, MAX_PHOTOS_PER_VEHICLE));
    }
  }
  return { byReg, unmatched, problems, extra };
}

export const regKey = norm;
