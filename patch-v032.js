/* מערכת ניהול שיבוצים מעון הדס — bootstrap גרסה 0.32.0 */
(() => {
  const VERSION='0.32.0';
  const files=['/patch-v031.js?v=0320','/patch-v032-core.js?v=0320','/patch-v032-exports.js?v=0320','/patch-v032-ux.js?v=0320','/patch-v032-stability.js?v=0320'];
  function pin(){window.__HADAS_RELEASE_VERSION=VERSION;const b=document.querySelector('#appVersionBadge');if(b){b.textContent=`v${VERSION}`;b.title=`גרסת מערכת ${VERSION}`;}const l=document.querySelector('#loginVersion');if(l)l.textContent=`גרסה ${VERSION}`;document.documentElement.dataset.hadasVersion=VERSION;}
  function load(src,index){return new Promise((resolve,reject)=>{const marker=`v032-${index}`,old=document.querySelector(`script[data-hadas-v032="${marker}"]`);if(old){if(old.dataset.loaded==='true')return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;}const s=document.createElement('script');s.src=src;s.async=false;s.dataset.hadasV032=marker;s.addEventListener('load',()=>{s.dataset.loaded='true';resolve();},{once:true});s.addEventListener('error',()=>reject(new Error(`לא ניתן לטעון ${src}`)),{once:true});document.head.append(s);});}
  async function boot(){if(window.__hadasV032BootstrapStarted)return;window.__hadasV032BootstrapStarted=true;pin();try{for(let i=0;i<files.length;i++)await load(files[i],i);pin();window.__hadasV032Installed=true;}catch(err){window.__hadasV032BootstrapStarted=false;console.error('Hadas v0.32 bootstrap failed',err);try{showToast('טעינת עדכון 0.32 נכשלה. יש לרענן את הדף.','error');}catch{}}}
  pin();boot();
})();
