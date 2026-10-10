'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const game = require('../server/game');
const root = path.join(__dirname,'..');
const output = path.join(root,'screenshots','upgrade');
const base = 'http://localhost:3137';
async function main() {
  fs.mkdirSync(output,{recursive:true});
  // A dedicated subdirectory, not os.tmpdir() itself: the server chmods the
  // checkpoint's directory to 0700, which a shared /tmp can't be locked to.
  const storeDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pyramids-3d-'));
  const proc=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,PORT:'3137',ROOM_STORE_PATH:path.join(storeDir,'rooms.json')},stdio:['ignore','pipe','inherit']});
  let browser;
  try {
    await new Promise((resolve,reject)=>{proc.stdout.on('data',d=>{if(String(d).includes('listening'))resolve();});proc.on('exit',reject);});
    browser=await chromium.launch({...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1280,height:1000}});
    const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    const host=await context.newPage();await host.goto(base+'/host.html');
    await host.waitForFunction(()=>/^[A-Z]{4}$/.test(document.getElementById('code').textContent));
    const code=await host.locator('#code').textContent();
    const phones=[];
    for(const name of ['<b>Ada</b>','Turing']) {
      const phone=await context.newPage();await phone.setViewportSize({width:390,height:844});
      await phone.goto(base+'/play.html?room='+code);await phone.fill('#namein',name);await phone.click('#joinBtn');
      await phone.waitForSelector('#waitview:not(.hidden)');phones.push(phone);
    }
    assert.equal(await host.locator('#players b').count(),0,'names are inert text');
    await host.click('#startBtn');
    await host.waitForSelector('#board.live-board canvas');
    await host.waitForFunction(()=>boardInstances.get(document.getElementById('board'))?.pieces.size>0);
    await host.screenshot({path:path.join(output,'host-3d.png'),fullPage:true});
    const state=await host.evaluate(()=>state);
    const engine={...state,cells:state.cells.map(row=>row.map(c=>({printed:c.p,stack:c.t?[...Array(c.n-1).fill({l:'?',v:0,o:'hidden'}),c.t]:[]})))};
    const words=fs.readFileSync(path.join(root,'data','words.txt'),'utf8').split(/\r?\n/).filter(w=>w.length>=3&&w.length<=5);
    const move=game.findMove(engine,state.current,words);assert.ok(move);
    const phone=phones[state.current==='red'?0:1];
    await phone.waitForSelector('#board.live-board canvas');
    // Project a known square through the renderer, then use a real pointer click.
    const point=await phone.evaluate(({r,c})=>{
      const b=boardInstances.get(document.getElementById('board'));const p=b.tiles[r*10+c].position.clone().project(b.camera);
      const rect=b.renderer.domElement.getBoundingClientRect();return{x:rect.x+(p.x+1)*rect.width/2,y:rect.y+(1-p.y)*rect.height/2};
    },move);
    await phone.mouse.click(point.x,point.y);
    await phone.click(move.dir==='H'?'#dirH':'#dirV');await phone.fill('#wordin',move.word);await phone.click('#previewBtn');
    await phone.waitForFunction(()=>draft?.ok);
    const before=await phone.evaluate(()=>JSON.stringify(state));
    const plan=await phone.evaluate(()=>draft.presentation);
    let captured=false;
    for(let i=0;i<plan.steps.length;i++) {
      await phone.click('#nextPieceBtn');
      if(plan.steps[i].kind==='move'&&!captured) {
        await phone.waitForFunction(id=>boardInstances.get(document.getElementById('board')).pieces.get(id).position.y>.5,plan.steps[i].pieceId);
        await phone.screenshot({path:path.join(output,'phone-amber-in-motion.png'),fullPage:true});captured=true;
      }
      await phone.waitForFunction(i=>placed===i+1&&!draftBusy,i);
    }
    assert.equal(await phone.evaluate(()=>JSON.stringify(state)),before,'draft does not mutate authoritative snapshot');
    await phone.screenshot({path:path.join(output,'phone-word-draft.png'),fullPage:true});
    await phone.click('#undoBtn');await phone.waitForFunction(()=>!draftBusy);
    assert.equal(await phone.evaluate(()=>placed),plan.steps.length-1);
    await phone.click('#nextPieceBtn');await phone.waitForFunction(()=>!draftBusy);
    await phone.click('#playBtn');
    await host.waitForFunction(()=>state.revision===1);
    assert.equal(await host.evaluate(()=>boardInstances.get(document.getElementById('board')).animating),true,'immediate snapshot does not cancel motion');
    await host.waitForFunction(()=>!boardInstances.get(document.getElementById('board')).animating);
    await host.screenshot({path:path.join(output,'host-after-word.png'),fullPage:true});
    const after=await host.evaluate(()=>state);
    for(const s of plan.steps.filter(s=>s.kind!=='printed'))assert.equal(after.cells[s.from[0]][s.from[1]].n,state.cells[s.from[0]][s.from[1]].n-1);
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'phone has no horizontal overflow');
    assert.deepEqual(errors,[]);
    console.log('PASS: real WebGL, mobile layout, inert names, amber lift/travel, draft undo, atomic submit, synchronized capture and source-only counts.');
    console.log('Screenshots: '+output);
  } finally {await browser?.close();proc.kill();fs.rmSync(storeDir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
