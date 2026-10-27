"use client";
import {useSyncExternalStore} from 'react';
import {hasNativeCapability} from '../../native/native-bridge';
import {nativeHapticsEnabled,setNativeHapticsEnabled} from '../../native/native-haptics';
const subscribe=(listener:()=>void)=>{window.addEventListener('native-haptics-change',listener);return()=>window.removeEventListener('native-haptics-change',listener);};
const available=()=>hasNativeCapability('haptics');
export function NativeHapticsControl(){
 const visible=useSyncExternalStore(subscribe,available,()=>false);
 const enabled=useSyncExternalStore(subscribe,nativeHapticsEnabled,()=>true);
 if(!visible)return null;
 return <label className="toggle my-4 flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={event=>setNativeHapticsEnabled(event.target.checked)}/><span>Touch feedback<small className="block text-xs opacity-70">Gentle taps and distinct feedback for results and milestones. Saved on this device.</small></span></label>;
}
