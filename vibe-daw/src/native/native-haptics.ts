import {hasNativeCapability,postToNative} from './native-bridge';
export type HapticPattern='press'|'send'|'message-complete'|'selection'|'drag-start'|'drag-tick'|'drop'|'success'|'warning'|'error';
const KEY='native-touch-feedback';
let enabled=true,lastTap=0;
export function nativeHapticsEnabled(){try{return localStorage.getItem(KEY)!=='off';}catch{return enabled;}}
export function setNativeHapticsEnabled(value:boolean){enabled=value;try{localStorage.setItem(KEY,value?'on':'off');}catch{}postToNative({type:'HAPTIC_SETTINGS',sensitivity:value?70:0});window.dispatchEvent(new Event('native-haptics-change'));if(value)haptic('selection');}
export function haptic(pattern:HapticPattern){if(hasNativeCapability('haptics')&&nativeHapticsEnabled())postToNative({type:'HAPTIC',pattern});}
export function startNativeHaptics(){
 postToNative({type:'HAPTIC_SETTINGS',sensitivity:nativeHapticsEnabled()?70:0});
 const tap=(event:MouseEvent)=>{const target=event.target instanceof Element?event.target.closest('button,[role="button"],[role="menuitem"],a[href],input[type="checkbox"],select'):null;if(!event.isTrusted||!target||target.matches(':disabled,[aria-disabled="true"],[data-haptic="semantic"]')||Date.now()-lastTap<80)return;lastTap=Date.now();haptic('selection');};
 document.addEventListener('click',tap,true);return()=>document.removeEventListener('click',tap,true);
}
