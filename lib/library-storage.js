const {getEnv,httpError}=require('./server');
const BUCKET='hadas-library';
async function storageRequest(path,options={}){
  const env=getEnv();
  const headers={apikey:env.secretKey,...options.headers};
  if(!env.secretKey.startsWith('sb_secret_'))headers.Authorization=`Bearer ${env.secretKey}`;
  const response=await fetch(`${env.url}/storage/v1/${path}`,{...options,headers,signal:AbortSignal.timeout(9000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={};}
  if(!response.ok)throw httpError(response.status===404?409:502,'לא ניתן לגשת לקובץ. אפשר לנסות שוב',data);
  return data;
}
function encoded(path){return `${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;}
async function signUpload(path){
  const data=await storageRequest(`object/upload/sign/${encoded(path)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({upsert:false})});
  const relative=data.url||data.signedURL||data.signedUrl;
  if(!relative)throw httpError(502,'לא התקבל קישור להעלאה');
  return relative.startsWith('http')?relative:`${getEnv().url}/storage/v1${relative.startsWith('/')?'':'/'}${relative}`;
}
async function verifyUpload(file){
  const info=await storageRequest(`object/info/${encoded(file.storage_path)}`);
  const actualSize=Number(info.metadata?.size??info.size);
  if(actualSize!==Number(file.size_bytes))throw httpError(409,`הקובץ ״${file.name}״ טרם הועלה במלואו. יש לנסות שוב`);
  const actualMime=String(info.metadata?.mimetype||info.contentType||'').split(';')[0].trim().toLowerCase();
  if(actualMime && actualMime!==file.mime_type)throw httpError(409,'סוג הקובץ שהועלה אינו תואם לקובץ שנבחר');
  return true;
}
module.exports={BUCKET,signUpload,verifyUpload};
