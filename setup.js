const statusBox=document.querySelector('#setupStatus');
const form=document.querySelector('#setupForm');
function status(message,type=''){statusBox.textContent=message;statusBox.className=`notice ${type}`.trim();}
async function check(){
  try{
    const response=await fetch('/api/bootstrap-status',{cache:'no-store'});const data=await response.json();
    if(data.needsSchema) return status(data.error,'error');
    if(!response.ok) throw new Error(data.error||'הבדיקה נכשלה');
    if(!data.needsBootstrap) return status('המערכת כבר הוקמה. אפשר לחזור למסך הכניסה.','success');
    status('המערכת מוכנה להקמה.');form.classList.remove('hidden');
  }catch(error){status(error.message,'error');}
}
form.addEventListener('submit',async(event)=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;button.textContent='מקים…';
  try{
    const body=Object.fromEntries(new FormData(form).entries());
    const response=await fetch('/api/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();
    if(!response.ok) throw new Error(data.error||'ההקמה נכשלה');
    form.classList.add('hidden');status(data.message||'המערכת הוקמה בהצלחה.','success');
  }catch(error){status(error.message,'error');}finally{button.disabled=false;button.textContent='הקמת לינור ואילנית';}
});
check();
