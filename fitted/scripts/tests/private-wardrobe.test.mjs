import test from "node:test";
import assert from "node:assert/strict";
import { privateWardrobeFlag, wardrobeExpectation, verifyStoredWardrobe, verifyFaithfulCapture, verifyOriginalPhoto, verifyWardrobeAck } from "../private-wardrobe-verification.mjs";
import { expectedDetail } from "../private-feedback-verification.mjs";
import { sha256 } from "../private-feedback-contract.mjs";
const id = n => n.toString(16).padStart(24, "0");
function fixture() {
  const owner = id(90), bytes = Buffer.from("authored original photo");
  const wardrobe = [1,2].map(n => ({ id: id(n), name: `Piece ${n}`, clothingType: n === 1 ? "top" : "bottom", subCategory: n === 1 ? "shirt" : "jeans", colors: ["blue", "white"], pattern: null, fit: null, layerRole: null, warmth: 5, isAvailable: true, photoMime: "image/png", photoSha256: sha256(bytes) }));
  const raw = wardrobe.map(item => ({ _id: item.id, user: owner, name: item.name, clothingType: item.clothingType, category: item.clothingType, colors: [...item.colors], subCategory: item.subCategory, fit: null, pattern: null, layerRole: null, warmth: 5, isAvailable: true, imagePath: `mongo:${id(Number.parseInt(item.id,16)+10)}`, createdAt: "2026-01-01", updatedAt: "2026-01-01" }));
  const row = { itemSnapshots: wardrobe.map((item,i) => ({ itemId: item.id, engineVisible: { name: item.name, clothingType: item.clothingType, warmth:5, subtype:item.subCategory, colorTags:[...item.colors], fit:null, pattern:null, layerRole:null }, evidence: { fit:null, image:{imageRef:raw[i].imagePath} } })), generationAttempts:[{rawText:JSON.stringify({outfits:[{items:wardrobe.map(item=>({itemId:item.id}))}]})}] };
  const result = { shown:[{displayItems:wardrobe.map((item,i)=>({itemId:item.id,imageUrl:`/api/images/${raw[i].imagePath.slice(6)}`}))}] };
  return {owner,bytes,input:{wardrobe},raw,row,result};
}
test("private wardrobe is explicit, separate and requires an absolute private fixture", () => {
  assert.equal(privateWardrobeFlag([]),false); assert.equal(privateWardrobeFlag(["--private-wardrobe","--private-replay=/private/input"]),true);
  for(const args of [["--private-wardrobe"],["--private-wardrobe","--private-replay=relative"],["--private-wardrobe","--private-wardrobe","--private-replay=/x"],...["--private-feedback","--private-lifecycle","--private-exclusions","--style-only","--feedback-only"].map(flag=>["--private-wardrobe","--private-replay=/x",flag])]) assert.throws(()=>privateWardrobeFlag(args));
});
test("authored overlays cannot mutate original colors or accept undeclared corrections", () => {
  const f=fixture(), copy=structuredClone(f.input), expected=wardrobeExpectation(f.input,id(1),{fit:"Relaxed",isAvailable:true});
  expected.wardrobe[0].colors.push("red"); assert.deepEqual(f.input,copy);
  assert.throws(()=>wardrobeExpectation(f.input,id(3),{fit:null,isAvailable:true}));
  assert.throws(()=>wardrobeExpectation(f.input,id(1),{fit:"Relaxed",isAvailable:true,warmth:9}));
});
test("raw undo permits only target null-to-empty clear, never unrelated changes", () => {
  const f=fixture(), actual=structuredClone(f.raw); actual[0].fit="";actual[0].updatedAt="2026-02-02";
  verifyStoredWardrobe(f.raw,actual,id(1),{fit:"",isAvailable:true});
  for(const mutate of [r=>r[0].warmth=7,r=>r[0].clothingType="dress",r=>r[0].colors.pop(),r=>r[1].updatedAt="later",r=>r[0].fit="Relaxed",r=>r.push({...r[0],_id:id(3)})]) {const bad=structuredClone(actual);mutate(bad);assert.throws(()=>verifyStoredWardrobe(f.raw,bad,id(1),{fit:"",isAvailable:true}));}
  assert.equal(expectedDetail(""),null);assert.equal(expectedDetail("  "),null);
});
test("capture checks all facts and exact photo identity, not only displayed candidates", () => {
  const f=fixture();verifyFaithfulCapture(f.row,f.result,f.input,f.raw);
  for(const mutate of [r=>r.itemSnapshots[1].engineVisible.warmth=9,r=>r.itemSnapshots[0].engineVisible.name="invented",r=>r.itemSnapshots[0].engineVisible.colorTags.pop(),r=>r.itemSnapshots[0].engineVisible.fit="Relaxed",r=>r.itemSnapshots[0].evidence.image.imageRef=`mongo:${id(99)}`]) {const bad=structuredClone(f.row);mutate(bad);assert.throws(()=>verifyFaithfulCapture(bad,f.result,f.input,f.raw));}
  const bad=structuredClone(f.result);bad.shown[0].displayItems[0].imageUrl=`/api/images/${id(99)}`;assert.throws(()=>verifyFaithfulCapture(f.row,bad,f.input,f.raw));
});
test("unavailable pieces are absent from capture, raw replay and displayed members", () => {
  const f=fixture(), expected=wardrobeExpectation(f.input,id(1),{fit:null,isAvailable:false});
  const row=structuredClone(f.row);row.itemSnapshots.shift();row.generationAttempts[0].rawText=JSON.stringify({outfits:[{items:[{itemId:id(2)}]}]});
  const result={shown:[{displayItems:[f.result.shown[0].displayItems[1]]}]};verifyFaithfulCapture(row,result,expected,f.raw);
  const bad=structuredClone(row);bad.generationAttempts[0].rawText=f.row.generationAttempts[0].rawText;assert.throws(()=>verifyFaithfulCapture(bad,result,expected,f.raw));
  assert.throws(()=>verifyFaithfulCapture(f.row,result,expected,f.raw));
});
test("photo receipt proves owner, garment, reference and original bytes", () => {
  const f=fixture(), image={_id:id(11),user:f.owner,wardrobeItem:id(1),contentType:"image/png",base64:f.bytes.toString("base64")};
  verifyOriginalPhoto(image,f.input.wardrobe[0],`mongo:${id(11)}`,f.owner);
  for(const patch of [{user:id(91)},{wardrobeItem:id(2)},{_id:id(99)},{base64:Buffer.from("changed").toString("base64")}]) assert.throws(()=>verifyOriginalPhoto({...image,...patch},f.input.wardrobe[0],`mongo:${id(11)}`,f.owner));
});
test("ACK expectations come from the authored baseline and preserve unknown projections", () => {
  const f=fixture(), item={...f.raw[0],id:id(1),fit:"Relaxed",pattern:"",layerRole:"",size:"",notes:"",seasons:[],occasions:[],supplementalImages:[]};
  verifyWardrobeAck(f.raw[0],item,{fit:"Relaxed",isAvailable:true});
  assert.throws(()=>verifyWardrobeAck(f.raw[0],{...item,fit:"Slim"},{fit:"Relaxed",isAvailable:true}));
  assert.throws(()=>verifyWardrobeAck(f.raw[0],{...item,warmth:9},{fit:"Relaxed",isAvailable:true}));
});

test("rescue captures its scoped prompt pool, not every other available base top", () => {
  const f=fixture(), third={...structuredClone(f.input.wardrobe[0]),id:id(3)}; f.input.wardrobe.push(third);
  f.raw.push({...structuredClone(f.raw[0]),_id:id(3),imagePath:`mongo:${id(13)}`});
  const digest=sha256(`["${id(1)}", "${id(2)}"]`);
  verifyFaithfulCapture(f.row,f.result,f.input,f.raw,{forcedItemId:id(1),poolDigests:[digest]});
  assert.throws(()=>verifyFaithfulCapture(f.row,f.result,f.input,f.raw,{forcedItemId:id(3),poolDigests:[digest]}));
  assert.throws(()=>verifyFaithfulCapture(f.row,f.result,f.input,f.raw,{poolDigests:["f".repeat(64)]}));
  const bad=structuredClone(f.row);bad.itemSnapshots[0].itemId=id(99);assert.throws(()=>verifyFaithfulCapture(bad,f.result,f.input,f.raw));
});
