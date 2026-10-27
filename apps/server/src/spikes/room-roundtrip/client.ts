// Standalone browser fixture: no production UI state, research data, or persisted commands.
export const clientHtml = String.raw`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room roundtrip spike · Synthetic card</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:28px;font:15px system-ui,sans-serif;background:#f1f5f8;color:#152d41}main{max-width:1000px;margin:auto}h1{font-size:26px;margin:0 0 6px}p{line-height:1.6}.notice{color:#546a7c}.toolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:22px 0}label{display:grid;gap:5px;font-weight:600}input,select,button{padding:9px 12px;border:1px solid #8b9eae;border-radius:6px;background:white;color:inherit;font:inherit}button{cursor:pointer;background:#173c58;color:white}button:disabled{opacity:.5;cursor:default}.status{display:flex;gap:20px;flex-wrap:wrap;padding:14px;background:white;border-radius:8px}.status strong{color:#116b54}#canvas{position:relative;width:100%;height:400px;margin:18px 0;border:1px solid #9db2c3;border-radius:10px;background-color:#fff;background-image:radial-gradient(#d3dee5 1px,transparent 1px);background-size:20px 20px;overflow:auto}#plane{position:relative;width:720px;height:400px}#card{position:absolute;left:100px;top:100px;width:160px;height:100px;padding:16px;border:2px solid #2685aa;border-radius:9px;background:#e2f3fa;box-shadow:0 4px 12px #173c5818;touch-action:none;cursor:grab;text-align:left;color:#152d41}#card:active{cursor:grabbing}#card:disabled{opacity:.65}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0}.metric{background:white;padding:14px;border-radius:8px}.metric b{display:block;font-size:22px;margin-top:6px}#members{word-break:break-all;font:13px ui-monospace,monospace}#error{min-height:24px;color:#a52d2d}code{font-family:ui-monospace,monospace}@media(max-width:500px){body{padding:16px}h1{font-size:22px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style>
<main><h1>Room roundtrip spike</h1><p class="notice">合成カードを使う通信実験 · Room = Project · メモリ上のみ。研究データ、保存、製品版の Command / Event には接続しません。</p>
<div class="toolbar"><label>参加先 Project Room<input id="project" value="demo" maxlength="32" pattern="[a-zA-Z0-9_-]{1,32}"></label><button id="join">参加 / Room 切替</button><button id="disconnect">切断</button><button id="reconnect">再接続</button><button id="leave">退出</button><label>送信上限<select id="frequency"><option>10</option><option selected>20</option><option>30</option><option>60</option></select>Hz（移動時のみ）</label></div>
<div class="status" role="status" aria-live="polite"><span>接続: <strong id="connection">connecting</strong></span><span>Room: <b id="room">—</b></span><span>接続 ID: <code id="identity">—</code></span></div>
<p id="error" role="alert"></p><div id="canvas"><div id="plane"><button id="card" disabled aria-label="合成カード。ドラッグまたは矢印キーで移動">Synthetic card<br><small>ドラッグ / 矢印キー</small></button></div></div>
<p>サーバー確定位置: <code id="coordinates">—</code> · Revision: <code id="revision">—</code></p>
<p>Room members (<b id="member-count">0</b>): <span id="members">—</span></p>
<div class="metrics"><div class="metric">送信 JSON frames<b id="sent">0</b></div><div class="metric">受信 JSON frames<b id="received">0</b></div><div class="metric">移動送信数 / 実効 Hz<b id="moves">0 / 0</b></div><div class="metric">ack RTT p50 / p95 (ms)<b id="rtt">—</b></div></div>
<button id="reset">この画面の計測をリセット</button><p class="notice">RTT はこのタブの performance.now() で送信から対応する ack 受信までを測定。別タブへの片道遅延ではありません。最後の最大 1000 サンプルを表示。実効 Hz は計測開始後の移動送信数 ÷ 経過秒（待機時間も含む）。pointerup 時は最終位置を即送信するため、短い追加送信があります。ブラウザは正常時に native pong を自動応答します。</p></main>
<script>
(() => {
const element = (id) => document.getElementById(id);
const project = element('project'), card = element('card'), plane = element('plane');
const requested = new URL(location.href).searchParams.get('project');
if(requested && /^[a-zA-Z0-9_-]{1,32}$/.test(requested)) project.value = requested;
let socket, reconnectTimer, timer, online = true, desiredJoined = true, joined = false, activeRoom, requestId = 0;
let position = {x:100,y:100}, pendingPosition, dragging, lastSent = -Infinity;
let sent = 0, received = 0, moves = 0, started = performance.now(), samples = [];
const pending = new Map();
const status = (text) => {element('connection').textContent = text;};
const error = (text) => {element('error').textContent = text;};
const updateMetrics = () => {
 element('sent').textContent = sent; element('received').textContent = received;
 element('moves').textContent = moves + ' / ' + (moves / Math.max(.001,(performance.now()-started)/1000)).toFixed(1);
 const sorted = [...samples].sort((a,b)=>a-b);
 const percentile = (p) => sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))].toFixed(2);
 element('rtt').textContent = sorted.length ? percentile(.5) + ' / ' + percentile(.95) : '—';
};
const send = (message) => {
 if(!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) return false;
 socket.send(JSON.stringify(message)); sent++; updateMetrics(); return true;
};
const display = (point) => {card.style.left = point.x+'px'; card.style.top = point.y+'px';};
const members = (ids) => { element('member-count').textContent = ids.length; element('members').textContent = ids.join(', ') || '—'; };
const clearMembership = () => {
 joined = false; activeRoom = undefined; pendingPosition = undefined; dragging = undefined; pending.clear();
 card.disabled = true; members([]); element('room').textContent = '—';
};
const join = () => {
 if(!/^[a-zA-Z0-9_-]{1,32}$/.test(project.value)){error('Room は英数字・_・- の 1〜32 文字です');return;}
 const requestedRoom = project.value;
 error(''); send({type:'join', projectId:requestedRoom});
};
const connect = () => {
 clearTimeout(reconnectTimer); clearMembership(); status('connecting');
 if(socket){const old = socket; socket = undefined; old.close();}
 const next = new WebSocket(location.origin.replace(/^http/, 'ws')+'/ws'); socket = next;
 next.onmessage = (event) => {
  if(socket !== next) return;
  let message;
  try {message = JSON.parse(event.data);} catch {error('サーバー JSON が不正です');return;}
  received++;
  if(message.type === 'ready'){element('identity').textContent = message.connectionId;status('connected');if(desiredJoined)join();}
  if(message.type === 'snapshot'){
   clearMembership();
   activeRoom = message.projectId; joined = true; card.disabled = false; position = message.position;
   display(position);element('coordinates').textContent = position.x+', '+position.y;
   element('revision').textContent = message.revision; element('room').textContent = activeRoom;members(message.members);status('joined');
  }
  if(message.type === 'members' && message.projectId === activeRoom) members(message.members);
  if(message.type === 'position' && message.projectId === activeRoom){
   position = message.position;if(!dragging) display(position);
   element('coordinates').textContent = position.x+', '+position.y;element('revision').textContent = message.revision;
  }
  if(message.type === 'ack'){
   const start = pending.get(message.requestId);
   if(start !== undefined){samples.push(performance.now()-start);if(samples.length>1000)samples.shift();pending.delete(message.requestId);}
  }
  if(message.type === 'left'){clearMembership(); status('connected / left');}
  if(message.type === 'reject') error('拒否: '+message.code);
  updateMetrics();
 };
 next.onclose = (event) => {
  if(socket !== next) return; socket = undefined; clearMembership();status('disconnected ('+event.code+')');
  if(online){status('reconnecting in 1s'); reconnectTimer = setTimeout(connect,1000);}
 };
 next.onerror = () => {if(socket === next) error('接続エラー。ローカルサーバーと Origin を確認してください');};
};
const flush = (force) => {
 if(!joined || !pendingPosition || (!force && performance.now()-lastSent < 1000/Number(element('frequency').value))) return;
 const point = pendingPosition; pendingPosition = undefined;
 const id = ++requestId, start = performance.now();
 if(send({type:'move',requestId:id,position:point})){
  pending.set(id,start); moves++; lastSent = start;
  for(const [key,time] of pending) if(start-time>10000 || pending.size>128) pending.delete(key);
  updateMetrics();
 }
};
const target = (x,y) => {pendingPosition = {x:Math.max(0,Math.min(560,Math.round(x))),y:Math.max(0,Math.min(300,Math.round(y)))};display(pendingPosition);};
card.onpointerdown = (event) => {
 if(!joined)return;
 const rect = card.getBoundingClientRect();dragging = {id:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top};card.setPointerCapture(event.pointerId);
};
card.onpointermove = (event) => {
 if(!dragging || dragging.id !== event.pointerId)return;
 const rect = plane.getBoundingClientRect();target(event.clientX-rect.left-dragging.dx,event.clientY-rect.top-dragging.dy);flush(false);
};
card.onpointerup = () => {if(dragging){flush(true);dragging = undefined;}};
card.onpointercancel = () => {dragging = undefined;pendingPosition = undefined;display(position);};
card.onkeydown = (event) => {
 const steps = {ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};const step = steps[event.key];
 if(!step || !joined)return;event.preventDefault();target(position.x+step[0],position.y+step[1]);flush(true);
};
element('join').onclick = () => {online = true;desiredJoined=true;if(socket && socket.readyState === WebSocket.OPEN) join();else connect();};
element('disconnect').onclick = () => {online=false;clearTimeout(reconnectTimer);if(socket)socket.close(1000,'manual disconnect');};
element('reconnect').onclick = () => {online=true;desiredJoined=true;connect();};
element('leave').onclick = () => {desiredJoined=false;send({type:'leave'});};
element('reset').onclick = () => {sent=0;received=0;moves=0;samples=[];pending.clear();started=performance.now();updateMetrics();};
timer = setInterval(()=>{flush(false);updateMetrics();},10);
window.addEventListener('pagehide',()=>{online=false;clearTimeout(reconnectTimer);clearInterval(timer);if(socket)socket.close();});
connect();
})();
</script></html>`;
