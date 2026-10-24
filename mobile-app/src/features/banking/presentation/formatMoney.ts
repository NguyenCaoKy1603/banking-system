export function formatVndMinor(amountMinor: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(amountMinor)) {
    return "—";
  }

  return `${amountMinor.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}

const DIGIT_WORDS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
const SCALES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];

function readThreeDigits(n: number, isHighest: boolean): string {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const units = n % 10;
  let res = "";

  if (hundreds > 0 || !isHighest) {
    res += `${DIGIT_WORDS[hundreds]} trăm `;
  }

  if (tens > 1) {
    res += `${DIGIT_WORDS[tens]} mươi `;
    if (units === 1) res += "mốt ";
    else if (units === 4) res += "tư ";
    else if (units === 5) res += "lăm ";
    else if (units > 0) res += `${DIGIT_WORDS[units]} `;
  } else if (tens === 1) {
    res += "mười ";
    if (units === 1) res += "một ";
    else if (units === 5) res += "lăm ";
    else if (units > 0) res += `${DIGIT_WORDS[units]} `;
  } else {
    if (units > 0) {
      if (hundreds > 0 || !isHighest) {
        res += `lẻ ${DIGIT_WORDS[units]} `;
      } else {
        res += `${DIGIT_WORDS[units]} `;
      }
    }
  }

  return res.trim();
}

export function formatVndWords(amountMinor: string): string {
  if (!/^[1-9]\d*$/.test(amountMinor)) return "";
  const str = amountMinor;
  const groups: number[] = [];
  let remaining = str;
  while (remaining.length > 0) {
    const chunk = remaining.slice(-3);
    groups.push(parseInt(chunk, 10));
    remaining = remaining.slice(0, -3);
  }

  let words = "";
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const isHighest = i === groups.length - 1;
    const groupText = readThreeDigits(g, isHighest);
    const scale = SCALES[i] ? ` ${SCALES[i]}` : "";
    words += `${words ? " " : ""}${groupText}${scale}`;
  }

  if (!words) return "";
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} đồng`;
}
