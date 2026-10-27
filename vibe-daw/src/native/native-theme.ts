/** Normalize actual CSS backgrounds before sending them to the iOS shell. */
export function nativeThemeColor(value:string):string|null {
 const text=value.trim();
 if(/^#[0-9a-f]{6}$/i.test(text))return text.toLowerCase();
 if(/^#[0-9a-f]{3}$/i.test(text))return '#'+text.slice(1).split('').map(c=>c+c).join('').toLowerCase();
 const match=text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?))?\s*\)$/i);
 if(!match || (match[4]!==undefined && Number(match[4])!==1))return null;
 const rgb=match.slice(1,4).map(Number);if(rgb.some(v=>!Number.isFinite(v)||v<0||v>255))return null;
 return '#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
}
