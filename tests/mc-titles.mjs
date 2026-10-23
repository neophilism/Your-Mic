import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spokenTrackTitle,mcTrackPlan,mcPlan} from '../lib/mc.ts';
const event={id:'show',artist:'Capture Shock',album:'Minnesota Ave.',mc_enabled:1,current_track:'a',version:0};
test('spoken titles remove explicit leading sequence numbers and preserve numbers in real titles',()=>{
 for(const [input,expected] of [['6. Early Mourning Blues','Early Mourning Blues'],['30. Debt of Injustice','Debt of Injustice'],['  006. Elephant In The Room  ','Elephant In The Room'],['30) Heavy Jazz','Heavy Jazz'],['100. Endzone','Endzone'],['99 Problems','99 Problems'],['1999','1999'],['30.06','30.06'],['6.66 Blues','6.66 Blues'],['Song 6. Part Two','Song 6. Part Two'],['6.','6.'],['30.  ','30.']])assert.equal(spokenTrackTitle(input),expected,input);
});
test('opening, closing, and rapper callouts use cleaned titles without mutating track data',()=>{
 const track={id:'a',title:'6. Early Mourning Blues',position:0},copy=structuredClone(track);
 for(const kind of ['track-start','track-end']){const plan=mcTrackPlan(event,track,kind);assert(plan.text.includes('Early Mourning Blues on Minnesota Ave. by Capture Shock'));assert(!plan.text.includes('6.'));assert(JSON.parse(plan.context).includes('Early Mourning Blues'));assert(!JSON.parse(plan.context).includes(track.title));}
 const named=mcTrackPlan(event,track,'track-start',{id:'entry',name:'MC 6'});assert(named.text.endsWith('MC 6, it’s your mic!'));
 assert.deepEqual(track,copy);
});
test('custom track placeholders are cleaned and explicitly written custom text is preserved',()=>{
 const track={id:'a',title:'30. Heavy Jazz',position:0,mc_intro_text:'Make room for {track}!',mc_text:'Big love for {track}.'};
 assert.equal(mcTrackPlan(event,track,'track-start').text,'Make room for Heavy Jazz!');assert.equal(mcTrackPlan(event,track,'track-end').text,'Big love for Heavy Jazz.');
 assert.equal(mcTrackPlan(event,{...track,mc_text:'Give it up for 30 years of music!'},'track-end').text,'Give it up for 30 years of music!');
});
test('the legacy combined introduction cleans outgoing and upcoming track titles',()=>{
 const tracks=[{id:'a',title:'6. Early Mourning Blues'},{id:'b',title:'30. Heavy Jazz'}];
 for(const entry of [null,{id:'q',name:'Rapper 30'}]){const plan=mcPlan(event,tracks,{mode:'auto',track:tracks[1],entry});assert(!plan.text.includes('6.'));assert(!plan.text.includes('30. Heavy'));assert(plan.text.includes('Early Mourning Blues'));assert(plan.text.includes('Heavy Jazz'));}
});
