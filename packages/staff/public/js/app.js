const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
// Must match conversationFor() in packages/shared/protocol.js (browser has no CommonJS loader).
const conversationFor=(a,b)=>`dm:${[String(a),String(b)].sort().join("--")}`;
let current="topic:general",latest={};
async function api(url,o){const r=await fetch(url,o),d=await r.json();if(!r.ok)throw new Error(d.error||"request failed");return d;}
function render(d){
  latest=d;const active=d.pairing==="approved",pending=d.pairing==="pending",people=(d.participants||[]).filter(p=>p.nodeId!==d.nodeId);
  $("#state").textContent=(d.pairing||"not registered").replace("-"," ").toUpperCase();
  $("#identity").textContent=d.agentName||"Set Name";
  $("#checkin").textContent=active?"Check Out":pending?"Waiting for Hub Approval":"Check In";$("#checkin").disabled=pending;
  $("#note").textContent=d.lastError||(active?"Checked in: join # general or start a direct chat with any online participant.":pending?"Check-in request sent. Waiting for Hub approval.":"Click Check In to send a registration request to the Hub.");
  $("#people").innerHTML=people.map(p=>`<div class="person"><b>${esc(p.agentName||p.nodeId)}</b><br><small>${esc(p.role||"")} · ${esc(p.clientType==="staff"?"staff":"agent")}</small><br><button data-id="${esc(p.nodeId)}">Direct</button></div>`).join("")||(active?"<span class=\"muted\">No other participants online right now.</span>":"<span class=\"muted\">Participants appear after check-in.</span>");
  $("#conversation").innerHTML=`<option value="topic:general"># general · all online participants</option>`+people.map(p=>`<option value="${esc(conversationFor(d.nodeId,p.nodeId))}">Direct · ${esc(p.agentName||p.nodeId)}</option>`).join("");
  if(![...$("#conversation").options].some(o=>o.value===current))current="topic:general";$("#conversation").value=current;
  const messages=(d.messages||[]).filter(m=>m.conversationId===current);$("#messages").innerHTML=messages.map(m=>`<div class="message ${m.fromNodeId===d.nodeId?"mine":""}"><b>${esc(m.from)}</b><time>${esc(new Date(m.at).toLocaleTimeString())}</time><p>${esc(m.text)}</p></div>`).join("")||"No messages yet.";$("#messages").scrollTop=$("#messages").scrollHeight;
  $("#text").disabled=!active;$("#send").disabled=!active;$("#text").placeholder=active?"Send a topic or direct message…":"Check in and wait for Hub approval…";
}
async function load(refresh=false){try{render(await api(refresh?"/api/refresh":"/api/status",refresh?{method:"POST"}:undefined));}catch(e){$("#note").textContent=e.message;}}
$("#conversation").onchange=e=>{current=e.target.value;render(latest);};
$("#checkin").onclick=async()=>{try{const route=latest.pairing==="approved"?"/api/logout":"/api/register";render(await api(route,{method:"POST"}));}catch(e){$("#note").textContent=e.message;}};
$("#identity").onclick=async()=>{const name=prompt("Display name:",latest.agentName||"");if(!name?.trim())return;try{render(await api("/api/profile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agentName:name})}));}catch(e){$("#note").textContent=e.message;}};
$("#form").onsubmit=async e=>{e.preventDefault();const input=$("#text"),text=input.value.trim();if(!text)return;input.value="";try{await api("/api/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,conversationId:current})});load(true);}catch(err){$("#note").textContent=err.message;}};
document.body.onclick=e=>{if(e.target.dataset.id){current=conversationFor(latest.nodeId,e.target.dataset.id);render(latest);}};load();setInterval(()=>load(true),10000);
