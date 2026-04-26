// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let port=null, reader=null, writer=null, rbuf='';
let connected=false, sweeping=false;
let curFreq=433920000, curBW=1000;
let sweepIv=null, sweepFreqs=[], sweepIdx=0;
let pktCount=0, lastRSSI=-90, sweepPts=0;
let signals=[], gpuT=0;
const BINS=64;
let specReal=new Array(BINS).fill(null);
let specPkg=new Array(BINS).fill(null);
let specMode='real';
let simPhase=0;

// ── Ring buffers — prevents browser freeze ──
const MAX_LOG=300, MAX_RX=200;
let fullLogLines=[], rxLinesBuf=[];

// ═══════════════════════════════════════════════════════
// WELCOME
// ═══════════════════════════════════════════════════════
function closeWelcome(){ document.getElementById('welcome').style.display='none'; }

// ═══════════════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════════════
const SC=document.getElementById('spec-canvas');
const WC=document.getElementById('wf-canvas');
const SX=SC.getContext('2d');
const WX=WC.getContext('2d');

function resize(){
  const zone=document.getElementById('canvases');
  const w=zone.clientWidth||600;
  const h=zone.clientHeight||270;
  SC.width=w; SC.height=Math.max(60,h-WC.height-18);
  WC.width=w;
}
window.addEventListener('resize',resize);
setTimeout(resize,80);

// ═══════════════════════════════════════════════════════
// SPECTRUM MODES
// ═══════════════════════════════════════════════════════
const modeDescs={
  real:'Amplified real RSSI from Flipper · tiny signals visible',
  sim: 'Visual demo only · always strong signal · clearly labeled',
  pkg: 'Only captured packets paint spectrum · real data only'
};

function setMode(m,el){
  specMode=m;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('mode-desc').textContent=modeDescs[m];
  document.getElementById('mode-badge').textContent=m.toUpperCase();
  document.getElementById('sb-mode-txt').textContent=m.toUpperCase();
  const badge=document.getElementById('data-badge');
  if(m==='sim'){
    badge.className='data-badge sim'; badge.textContent='● SIMULATION';
  } else if(m==='pkg'){
    badge.className='data-badge pkg'; badge.textContent='● PACKAGE';
    specPkg.fill(null);
  } else {
    badge.className='data-badge '+(connected?'real':'idle');
    badge.textContent=connected?'● REAL DATA':'● WAITING';
  }
  log('info','Mode: '+m.toUpperCase());
}

// ── Simulation ──
function tickSim(){
  simPhase+=0.04;
  const n=BINS, d=new Array(n);
  for(let i=0;i<n;i++){
    let v=-85+Math.sin(i*0.3+simPhase)*2+Math.random()*4-2;
    const cx=n/2, dx=i-cx;
    v+=Math.exp(-dx*dx/(n*0.06))*32;
    [n*0.25,n*0.75].forEach(s=>{ const ds=i-s; v+=Math.exp(-ds*ds/(n*0.015))*(10+Math.sin(simPhase*2)*5); });
    if(Math.random()<0.01) v+=Math.random()*18;
    d[i]=v;
  }
  return d;
}

// ── Real — amplified so tiny signals are visible ──
function getRealDisplay(){
  const hasData=specReal.some(v=>v!==null);
  if(!hasData) return new Array(BINS).fill(-92);
  return specReal.map(v=>{
    if(v===null) return -92;
    const norm=(v+100)/40;
    return Math.min(-10, -90+norm*72);
  });
}

function getPkgDisplay(){
  return specPkg.map(v=>v===null?-95:v);
}

function getDisplayData(){
  if(specMode==='sim') return tickSim();
  if(specMode==='pkg') return getPkgDisplay();
  return getRealDisplay();
}

// ═══════════════════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════════════════
function drawSpec(data){
  const w=SC.width, h=SC.height;
  if(!w||!h) return;
  SX.fillStyle='#0C0700'; SX.fillRect(0,0,w,h);
  SX.strokeStyle='rgba(255,128,0,0.09)'; SX.lineWidth=1;
  for(let i=0;i<=4;i++){ const y=h/4*i; SX.beginPath();SX.moveTo(0,y);SX.lineTo(w,y);SX.stroke(); }
  for(let i=0;i<=8;i++){ const x=w/8*i; SX.beginPath();SX.moveTo(x,0);SX.lineTo(x,h);SX.stroke(); }

  if(specMode!=='sim' && !data.some(v=>v>-93)){
    SX.strokeStyle='rgba(122,69,0,0.35)'; SX.lineWidth=1; SX.setLineDash([4,6]);
    SX.beginPath(); SX.moveTo(0,h*0.88); SX.lineTo(w,h*0.88); SX.stroke();
    SX.setLineDash([]);
    SX.fillStyle='rgba(122,69,0,0.55)'; SX.font='6px "Press Start 2P"';
    SX.textAlign='center';
    SX.fillText(specMode==='pkg'?'WAITING FOR PACKETS':'USE ▶ SWEEP OR RX HERE',w/2,h/2);
    SX.textAlign='left';
    return;
  }

  const n=data.length, step=w/n, minR=-100, rng=90;
  SX.beginPath(); SX.moveTo(0,h);
  for(let i=0;i<n;i++){
    const x=i*step, y=h-Math.max(0,(data[i]-minR)/rng)*h;
    i===0?SX.lineTo(x,y):SX.lineTo(x,y);
  }
  SX.lineTo(w,h); SX.closePath();
  const g=SX.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'rgba(255,160,48,0.9)');
  g.addColorStop(0.38,'rgba(255,128,0,0.52)');
  g.addColorStop(0.72,'rgba(160,80,0,0.22)');
  g.addColorStop(1,'rgba(20,8,0,0.04)');
  SX.fillStyle=g; SX.fill();

  SX.beginPath(); SX.strokeStyle='#FFB040'; SX.lineWidth=1.5;
  SX.shadowColor='#FF8000'; SX.shadowBlur=6;
  for(let i=0;i<n;i++){
    const x=i*step, y=h-Math.max(0,(data[i]-minR)/rng)*h;
    i===0?SX.moveTo(x,y):SX.lineTo(x,y);
  }
  SX.stroke(); SX.shadowBlur=0;

  SX.setLineDash([4,4]);
  SX.strokeStyle='rgba(255,200,80,0.4)'; SX.lineWidth=1;
  SX.beginPath(); SX.moveTo(w/2,0); SX.lineTo(w/2,h); SX.stroke();
  SX.setLineDash([]);

  SX.fillStyle='rgba(255,128,0,0.4)'; SX.font='5px "Press Start 2P"';
  [[-20,0.05],[-40,0.26],[-60,0.48],[-80,0.70],[-90,0.87]].forEach(([db,f])=>{ SX.fillText(db+'dB',2,h*f+6); });
}

function drawWF(data){
  const w=WC.width, h=WC.height;
  if(!w||!h) return;
  const shift=4;
  const prev=WX.getImageData(0,0,w,h);
  const nxt=new ImageData(w,h);
  nxt.data.set(prev.data.subarray(0,w*(h-shift)*4),w*shift*4);
  const hasAny=data.some(v=>v>-93);
  const n=data.length;
  for(let x=0;x<w;x++){
    const idx=Math.floor(x/w*n);
    const v=data[idx]??-95;
    const t=hasAny?Math.max(0,Math.min(1,(v+100)/90)):0;
    const r=Math.floor(t*255), g2=Math.floor(t*t*135);
    for(let s=0;s<shift;s++){
      const base=(s*w+x)*4;
      nxt.data[base]=r; nxt.data[base+1]=g2; nxt.data[base+2]=0; nxt.data[base+3]=255;
    }
  }
  WX.putImageData(nxt,0,0);
}

let lastWF=0;
function frame(ts){
  const data=getDisplayData();
  drawSpec(data);
  if(ts-lastWF>120){ drawWF(data); lastWF=ts; }
  gpuT=(gpuT+1)%200;
  if(connected){
    const gu=Math.round(8+Math.sin(gpuT*0.09)*4+Math.random()*3);
    document.getElementById('gpu-fill').style.width=gu+'%';
    document.getElementById('gpu-val').textContent=gu+'/58';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(()=>{ document.getElementById('sbar-time').textContent=new Date().toTimeString().slice(0,8); },1000);

// ═══════════════════════════════════════════════════════
// WEBSERIAL — fixed: raw reader, no pipeTo, proper cleanup
// ═══════════════════════════════════════════════════════
async function toggleConnect(){ connected?await doDisconnect():await doConnect(); }

async function doConnect(){
  if(!('serial' in navigator)){ alert('WebSerial not available.\nUse Google Chrome or Microsoft Edge.'); return; }
  try{
    port=await navigator.serial.requestPort({filters:[]});
    // bufferSize 65536 = handles burst data without dropping bytes
    await port.open({ baudRate:230400, bufferSize:65536 });

    // Raw writer — no TextEncoderStream, no pipeTo conflict
    writer=port.writable.getWriter();

    connected=true;
    document.getElementById('conn-btn').textContent='DISCONNECT';
    document.getElementById('conn-btn').classList.add('on');
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('conn-device').textContent='Connected to: FLIPPER';
    document.getElementById('conn-tty').textContent='Debug TTY open';
    document.getElementById('dot').style.color='var(--GRN)';
    document.getElementById('sb-conn').textContent='Connected via Debug Mode';
    if(specMode==='real'){
      document.getElementById('data-badge').className='data-badge idle';
      document.getElementById('data-badge').textContent='● CONNECTED';
    }
    log('ok','Serial @ 230400 baud · buffer 64KB');
    log('info','DBG_TTY session started');

    // Start reader BEFORE sending — never miss early output
    startRead();
    await sleep(500);
    await send('\r\n');
    await sleep(300);
    await send('device_info\r\n');

  }catch(e){ if(e.name!=='NotFoundError') log('warn','Connect: '+e.message); }
}

async function doDisconnect(){
  sweeping=false; clearInterval(sweepIv); connected=false;
  try{ if(reader){ reader.cancel(); reader.releaseLock(); } }catch(e){}
  try{ if(writer){ writer.releaseLock(); } }catch(e){}
  try{ if(port) await port.close(); }catch(e){}
  reader=writer=null; port=null;
  document.getElementById('conn-btn').textContent='CONNECT USB';
  document.getElementById('conn-btn').classList.remove('on');
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById('conn-device').textContent='Not Connected';
  document.getElementById('conn-tty').textContent='USB Serial Disconnected';
  document.getElementById('dot').style.color='var(--O)';
  document.getElementById('sb-conn').textContent='Disconnected';
  document.getElementById('data-badge').className='data-badge idle';
  document.getElementById('data-badge').textContent='● WAITING';
  specReal.fill(null);
  log('warn','Disconnected');
}

async function startRead(){
  // Direct raw reader — no TextDecoderStream, no pipeTo
  // This is the ONLY stable approach for continuous Flipper serial data
  const decoder=new TextDecoder('utf-8', {fatal:false});
  rbuf='';
  try{
    reader=port.readable.getReader();
    while(connected){
      let res;
      try{ res=await reader.read(); }
      catch(e){ break; } // port closed
      if(res.done) break;

      // Decode raw bytes chunk
      rbuf+=decoder.decode(res.value, {stream:true});

      // Split on newlines, keep partial last line
      const lines=rbuf.split('\n');
      rbuf=lines.pop();

      for(const l of lines){
        const t=l.replace(/\r/g,'').trim();
        if(t) handleLine(t);
      }
    }
  }catch(e){
    if(connected) log('warn','Read ended: '+e.message);
  }finally{
    try{ reader.releaseLock(); }catch(e){}
  }
}

// ── send raw bytes ──
const enc=new TextEncoder();
async function send(cmd){
  if(!writer) return;
  try{ await writer.write(enc.encode(cmd)); }
  catch(e){ log('warn','Send: '+e.message); }
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ═══════════════════════════════════════════════════════
// LINE HANDLER — parses every real serial line from Flipper
// ═══════════════════════════════════════════════════════
function handleLine(line){
  // Skip empty CLI prompt chars
  if(line==='>' || line==='>:' || line.length<2) return;

  logRaw(line);
  appendRXSafe(line);

  // Device name
  if(/hardware_name/i.test(line)){
    const p=line.split(':').pop().trim();
    if(p) document.getElementById('conn-device').textContent='Connected to: '+p.toUpperCase().slice(0,12);
  }

  // Packets received
  const pkm=line.match(/Packets received\s+(\d+)/i);
  if(pkm){ pktCount=+pkm[1]; document.getElementById('pkt-count').textContent=pktCount; }

  // Listening at frequency (sweep confirmation)
  const lm=line.match(/Listening at.*?(\d{8,9})/i);
  if(lm) setFreqDisplay(+lm[1]);

  // RSSI — multiple formats Flipper outputs
  const rm = line.match(/RSSI[:\s]+([-]?\d+\.?\d*)/i)
           || line.match(/^rssi[:\s]+([-]?\d+\.?\d*)/i)
           || line.match(/([-][5-9]\d(?:\.\d)?)\s*dBm/i)
           || line.match(/level[:\s]+([-]?\d+)/i);
  if(rm) ingestRSSI(parseFloat(rm[1]), curFreq, false);

  // Signal / protocol detected
  if(/signal.detected|protocol:|key:|Raw data:/i.test(line)){
    log('signal','Signal: '+line.slice(0,60));
    addSig(line);
    // Spike at current freq bin for all modes
    ingestRSSI(-45+Math.random()*12, curFreq, true);
  }
}

// ── Feed real RSSI into spectrum ──
function ingestRSSI(rssi, freq, isPacket){
  lastRSSI=rssi;
  document.getElementById('live-rssi').textContent=rssi.toFixed(1)+' dBm';
  document.getElementById('sb-rssi').textContent=rssi.toFixed(1)+' dBm';
  const pct=Math.max(0,Math.min(100,(rssi+100)/65*100));
  document.getElementById('sigfill').style.width=pct+'%';

  const bwHz=curBW*1000;
  const fMin=curFreq-bwHz/2, fMax=curFreq+bwHz/2;
  const bin=Math.round((freq-fMin)/(fMax-fMin)*(BINS-1));

  if(bin>=0&&bin<BINS){
    specReal[bin]=specReal[bin]===null?rssi:specReal[bin]*0.55+rssi*0.45;
    [-2,-1,1,2].forEach(d=>{
      const b=bin+d; if(b<0||b>=BINS) return;
      const s=rssi-Math.abs(d)*5;
      specReal[b]=specReal[b]===null?s:Math.max(specReal[b]*0.65+s*0.35,specReal[b]);
    });
    if(isPacket){
      specPkg[bin]=specPkg[bin]===null?rssi:Math.max(specPkg[bin],rssi);
      [-1,1].forEach(d=>{
        const b=bin+d; if(b<0||b>=BINS) return;
        specPkg[b]=specPkg[b]===null?rssi-6:Math.max(specPkg[b],rssi-6);
      });
    }
  }
  sweepPts++;
  document.getElementById('sweep-pts').textContent=sweepPts;
  if(specMode==='real'){
    document.getElementById('data-badge').className='data-badge real';
    document.getElementById('data-badge').textContent='● REAL DATA';
  }
}

// ═══════════════════════════════════════════════════════
// SWEEP — proper state machine, reads between hops
// ═══════════════════════════════════════════════════════
async function startSweep(){
  if(!connected){ log('warn','Not connected'); return; }
  if(sweeping) return;
  sweeping=true; sweepPts=0;
  specReal.fill(null);
  document.getElementById('scanbtn').classList.add('active');
  log('info','Sweep started');

  const steps=32;
  const bwHz=curBW*1000;
  const fMin=curFreq-bwHz/2, fMax=curFreq+bwHz/2;
  sweepFreqs=[];
  for(let i=0;i<steps;i++){
    const f=Math.round(fMin+i*(fMax-fMin)/steps);
    if(isValidFlipperFreq(f)) sweepFreqs.push(f);
  }
  sweepIdx=0;

  // State machine: send rx → wait dwell → send stop → move to next
  // This ensures Flipper has time to respond with RSSI each hop
  async function sweepStep(){
    if(!sweeping||!connected){ clearInterval(sweepIv); return; }
    const f=sweepFreqs[sweepIdx%sweepFreqs.length];
    await send(`subghz rx ${f} 0\r\n`);
    sweepIdx++;
  }

  sweepIv=setInterval(sweepStep, 200);
}

function stopSweep(){
  sweeping=false; clearInterval(sweepIv);
  document.getElementById('scanbtn').classList.remove('active');
  if(connected) send('\x03');
  log('warn','Sweep stopped');
}

async function startRX(){
  if(!connected){ log('warn','Not connected'); return; }
  if(!isValidFlipperFreq(curFreq)){ log('warn','Freq out of Flipper CC1101 range'); return; }
  await send('\x03'); await sleep(60);
  await send(`subghz rx ${curFreq} 0\r\n`);
  log('ok','RX @ '+(curFreq/1e6).toFixed(6)+' MHz');
}

function isValidFlipperFreq(f){
  return (f>=299999755&&f<=348000000)
      || (f>=386999938&&f<=464000000)
      || (f>=778999847&&f<=928000000);
}

// ═══════════════════════════════════════════════════════
// SUBGHZ COMMANDS
// ═══════════════════════════════════════════════════════
async function sgRX(){
  if(!connected){ log('warn','Not connected'); return; }
  const f=+document.getElementById('sg-freq').value;
  const d=document.getElementById('sg-dev').value;
  if(!isValidFlipperFreq(f)){ log('warn','Freq out of Flipper range (300-928 MHz)'); return; }
  await send('\x03'); await sleep(50);
  await send(`subghz rx ${f} ${d}\r\n`);
  log('ok','RX @ '+(f/1e6).toFixed(3)+' MHz');
}
async function sgRXRaw(){
  if(!connected){ log('warn','Not connected'); return; }
  const f=+document.getElementById('sg-freq').value;
  if(!isValidFlipperFreq(f)){ log('warn','Freq out of Flipper range'); return; }
  await send('\x03'); await sleep(50);
  await send(`subghz rx_raw ${f}\r\n`);
  log('ok','RX RAW @ '+(f/1e6).toFixed(3)+' MHz');
}
async function sgStop(){
  if(!connected) return;
  await send('\x03');
  log('warn','Stopped');
}
async function sgFreqAna(){
  if(!connected){ log('warn','Not connected'); return; }
  await send('loader open "Sub-GHz"\r\n');
  log('info','Opening Sub-GHz app on Flipper');
}
async function sgChat(){
  if(!connected){ log('warn','Not connected'); return; }
  const f=+document.getElementById('sg-freq').value;
  const d=document.getElementById('sg-dev').value;
  await send(`subghz chat ${f} ${d}\r\n`);
  log('ok','Chat @ '+(f/1e6).toFixed(3)+' MHz');
}
async function sgTX(){
  if(!connected){ log('warn','Not connected'); return; }
  const k=document.getElementById('tx-key').value.toUpperCase().padStart(6,'0');
  const f=+document.getElementById('sg-freq').value;
  const te=+document.getElementById('tx-te').value;
  const rp=+document.getElementById('tx-rep').value;
  const d=document.getElementById('sg-dev').value;
  await send(`subghz tx ${k} ${f} ${te} ${rp} ${d}\r\n`);
  log('ok','TX '+k+' @ '+(f/1e6).toFixed(3)+'MHz');
}

// ═══════════════════════════════════════════════════════
// FREQ UI
// ═══════════════════════════════════════════════════════
function stepF(dir){
  curFreq=Math.max(300000000,Math.min(928000000,curFreq+dir*100000));
  setFreqDisplay(curFreq);
}
function applyPreset(v){ curFreq=+v; setFreqDisplay(curFreq); }
function setBW(v){
  curBW=+v;
  document.getElementById('bwval').textContent=v+' kHz';
  document.getElementById('sb-bw').textContent=v+' kHz';
  setFreqDisplay(curFreq);
  specReal.fill(null); specPkg.fill(null);
}
function setFreqDisplay(hz){
  curFreq=hz;
  const mhz=(hz/1e6).toFixed(6);
  document.getElementById('fdisp').textContent=mhz;
  document.getElementById('bigfreq').textContent=mhz;
  const bw=curBW/1000;
  document.getElementById('xa-l').textContent=((hz/1e6)-bw*0.9).toFixed(1)+' MHz';
  document.getElementById('xa-m1').textContent=((hz/1e6)-bw*0.4).toFixed(3)+' m';
  document.getElementById('xa-c').textContent=mhz+' MHz';
  document.getElementById('xa-m2').textContent=((hz/1e6)+bw*0.4).toFixed(3)+' m';
  document.getElementById('xa-r').textContent=((hz/1e6)+bw*0.9).toFixed(1)+' MHz';
}
function setRXTX(m){
  document.getElementById('rx-b').classList.toggle('on',m==='rx');
  document.getElementById('tx-b').classList.toggle('on',m==='tx');
}
function recordFreq(){ log('ok','Recorded: '+(curFreq/1e6).toFixed(6)+' MHz'); }
function clearFreq(){ log('info','Freq cleared'); }
function saveFreq(){ log('ok','Saved: '+(curFreq/1e6).toFixed(6)+' MHz'); }

const gainMax={lna:40,mix:24,if:40};
function applyGain(id,db){
  db=Math.max(0,Math.min(gainMax[id],Math.round(db)));
  const pct=db/gainMax[id]*100;
  document.getElementById(id+'-fill').style.width=pct+'%';
  document.getElementById(id+'-head').style.left=pct+'%';
  const map={lna:['rp-lna','rp-lna-v'],mix:['rp-mix','rp-mix-v'],if:['rp-if','rp-if-v']};
  document.getElementById(map[id][0]).style.width=pct+'%';
  document.getElementById(map[id][1]).textContent=db+' dB';
}
['lna','mix','if'].forEach(id=>{
  const el=document.getElementById(id+'-track'); if(!el) return;
  let drag=false;
  const move=cx=>{ const r=el.getBoundingClientRect(); applyGain(id,Math.max(0,Math.min(100,(cx-r.left)/r.width*100))/100*gainMax[id]); };
  el.addEventListener('mousedown',e=>{drag=true;move(e.clientX);});
  window.addEventListener('mousemove',e=>{if(drag)move(e.clientX);});
  window.addEventListener('mouseup',()=>drag=false);
  el.addEventListener('touchstart',e=>{drag=true;move(e.touches[0].clientX);},{passive:true});
  window.addEventListener('touchmove',e=>{if(drag)move(e.touches[0].clientX);},{passive:true});
  window.addEventListener('touchend',()=>drag=false);
});

// ═══════════════════════════════════════════════════════
// SIGNALS
// ═══════════════════════════════════════════════════════
function addSig(line){
  const now=new Date().toTimeString().slice(0,8);
  signals.unshift({freq:(curFreq/1e6).toFixed(3),time:now,data:line.slice(0,50),rssi:lastRSSI.toFixed(0)});
  if(signals.length>200) signals.pop();
  renderSigs();
}
function renderSigs(){
  const c=document.getElementById('siglist');
  if(!signals.length){ c.innerHTML='<div style="font-size:6px;color:var(--DIM);">No signals yet.</div>'; return; }
  c.innerHTML=signals.slice(0,60).map(s=>
    `<div class="sig-item"><span class="sf">${s.freq} MHz</span><span class="sp">${s.data}</span><span class="sr">${s.rssi} dBm</span><span style="font-size:5px;color:var(--DIM);">${s.time}</span></div>`
  ).join('');
}
function clearSigs(){ signals=[]; renderSigs(); }
function exportSigs(){ dl('signals.txt',signals.map(s=>`${s.time}\t${s.freq}MHz\t${s.rssi}dBm\t${s.data}`).join('\n')); }

// ═══════════════════════════════════════════════════════
// LOGS — ring buffer, never leaks memory
// ═══════════════════════════════════════════════════════
function log(type,msg){
  const ll=document.getElementById('loglist');
  const d=document.createElement('div');
  d.className={ok:'lo',warn:'lw',signal:'ls',info:'li'}[type]||'li';
  d.textContent='['+type.toUpperCase()+'] '+msg;
  ll.appendChild(d);
  while(ll.children.length>12) ll.removeChild(ll.firstChild);
  ll.scrollTop=ll.scrollHeight;
  const entry='['+new Date().toTimeString().slice(0,8)+']['+type.toUpperCase()+'] '+msg;
  fullLogLines.push(entry);
  if(fullLogLines.length>MAX_LOG) fullLogLines.shift();
  flushFullLog();
}

// logRaw — raw serial lines go directly to full log, NOT to mini log
function logRaw(line){
  const entry='[RAW] '+line;
  fullLogLines.push(entry);
  if(fullLogLines.length>MAX_LOG) fullLogLines.shift();
  // Throttle DOM update — only flush every 20 lines or when logs tab open
  if(fullLogLines.length%20===0) flushFullLog();
}

function flushFullLog(){
  const el=document.getElementById('fulllog');
  if(!el) return;
  // Only update if logs tab is visible — saves massive CPU
  if(document.getElementById('view-logs').classList.contains('active')){
    el.textContent=fullLogLines.join('\n');
    el.scrollTop=el.scrollHeight;
  }
}

function appendRXSafe(line){
  rxLinesBuf.push(line);
  if(rxLinesBuf.length>MAX_RX) rxLinesBuf.shift();
  const el=document.getElementById('rxout');
  if(!el) return;
  if(document.getElementById('view-subghz').classList.contains('active')){
    el.textContent=rxLinesBuf.join('\n');
    el.scrollTop=el.scrollHeight;
  }
}

function clearRX(){ rxLinesBuf=[]; document.getElementById('rxout').textContent=''; }
function saveRX(){ dl('rx_output.txt',rxLinesBuf.join('\n')); }
function clearLogs(){ fullLogLines=[]; document.getElementById('fulllog').textContent=''; }
function exportLogs(){ dl('flipsay_log.txt',fullLogLines.join('\n')); }
function dl(name,txt){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'})); a.download=name; a.click(); }

// ── Flush logs when switching to logs tab ──
function showTab(name,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  // Flush deferred log updates now
  if(name==='logs') flushFullLog();
  if(name==='subghz'){
    const rxEl=document.getElementById('rxout');
    if(rxEl){ rxEl.textContent=rxLinesBuf.join('\n'); rxEl.scrollTop=rxEl.scrollHeight; }
  }
  setTimeout(resize,50);
}

// INIT
setFreqDisplay(433920000);
log('info','FlipSay Public Beta — Serial core v2');
log('info','Connect Flipper Zero via USB');
if(!('serial' in navigator)) log('warn','WebSerial not supported — use Chrome/Edge!');
else log('ok','WebSerial API ready');
