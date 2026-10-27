import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
const string = (value:string):string => JSON.stringify(value).replace(/[\u007f-\uffff]/g,character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'));
// Restricted ata-json-v1 encoding. It is not general RFC 8785 canonicalization.
export function canonicalJson(value:unknown):string {
  const ancestors=new Set<object>();let count=0;
  const encode=(item:unknown,depth:number):string=>{
    if(depth>64 || ++count>100000)throw new TypeError('Canonical value exceeds bounds');
    if(item===null)return 'null';
    if(typeof item==='string')return string(item);
    if(typeof item==='boolean')return item?'true':'false';
    if(typeof item==='number'){if(!Number.isSafeInteger(item))throw new TypeError('Canonical numbers must be safe integers');return String(item);}
    if(typeof item!=='object')throw new TypeError('Unsupported canonical value');
    if(ancestors.has(item))throw new TypeError('Cyclic canonical value');
    ancestors.add(item);
    let result:string;
    if(Array.isArray(item))result='['+Array.from(item,child=>encode(child,depth+1)).join(',')+']';
    else {
      if(Object.getPrototypeOf(item)!==Object.prototype && Object.getPrototypeOf(item)!==null)throw new TypeError('Canonical objects must be plain data');
      const keys=Object.keys(item).sort();
      for(const key of keys)if(!/^[\x20-\x7e]+$/.test(key)||['__proto__','prototype','constructor'].includes(key))throw new TypeError('Unsupported canonical key');
      result='{'+keys.map(key=>string(key)+':'+encode((item as Record<string,unknown>)[key],depth+1)).join(',')+'}';
    }
    ancestors.delete(item);return result;
  };
  return encode(value,0);
}
export function sha256Text(value:string):string {return bytesToHex(sha256(utf8ToBytes(value)));}
export function sha256Json(value:unknown):string {return sha256Text(canonicalJson(value));}
