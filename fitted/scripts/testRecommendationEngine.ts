/**
 * Test script for the Outfit Recommendation Engine
 * Run with: npx tsx scripts/testRecommendationEngine.ts
 */

import { OutfitRecommendationEngine, WardrobeItemML, toMLItem } from '../lib/recommendationEngine';

// Sample wardrobe items for testing (using "All" seasons to focus on occasion testing)
const testWardrobe: WardrobeItemML[] = [
  // TOPS
  { id: "1", name: "Gray Hoodie", clothingType: "top", category: "hoodie", colors: ["gray"], occasions: ["Casual", "Athletic"], seasons: ["All"] },
  { id: "2", name: "White T-Shirt", clothingType: "top", category: "t-shirt", colors: ["white"], occasions: ["Casual", "Athletic"], seasons: ["All"] },
  { id: "3", name: "Navy Polo", clothingType: "top", category: "polo", colors: ["navy"], occasions: ["Business", "Casual"], seasons: ["All"] },
  { id: "4", name: "Black Dress Shirt", clothingType: "top", category: "dress shirt", colors: ["black"], occasions: ["Formal", "Business"], seasons: ["All"] },
  { id: "5", name: "Red Tank Top", clothingType: "top", category: "tank", colors: ["red"], occasions: ["Athletic", "Casual"], seasons: ["All"] },
  { id: "6", name: "Blue Sweater", clothingType: "top", category: "sweater", colors: ["blue"], occasions: ["Casual", "Date Night"], seasons: ["All"] },
  { id: "7", name: "Gray Blazer", clothingType: "top", category: "blazer", colors: ["gray"], occasions: ["Formal", "Business"], seasons: ["All"] },
  
  // BOTTOMS
  { id: "10", name: "Khaki Shorts", clothingType: "bottom", category: "shorts", colors: ["khaki", "beige"], occasions: ["Casual"], seasons: ["All"] },
  { id: "11", name: "Blue Jeans", clothingType: "bottom", category: "jeans", colors: ["blue"], occasions: ["Casual", "Going Out"], seasons: ["All"] },
  { id: "12", name: "Black Dress Pants", clothingType: "bottom", category: "dress pants", colors: ["black"], occasions: ["Formal", "Business"], seasons: ["All"] },
  { id: "13", name: "Gray Sweatpants", clothingType: "bottom", category: "sweatpants", colors: ["gray"], occasions: ["Athletic", "Casual"], seasons: ["All"] },
  { id: "14", name: "Navy Chinos", clothingType: "bottom", category: "chinos", colors: ["navy"], occasions: ["Business", "Casual"], seasons: ["All"] },
  { id: "15", name: "Black Running Shorts", clothingType: "bottom", category: "athletic shorts", colors: ["black"], occasions: ["Athletic"], seasons: ["All"] },
];

// Expected good combinations (ground truth)
const goodCombinations = [
  { top: "Gray Hoodie", bottom: "Khaki Shorts", occasion: "Casual", expected: "good" },
  { top: "Gray Hoodie", bottom: "Gray Sweatpants", occasion: "Athletic", expected: "good" },
  { top: "White T-Shirt", bottom: "Blue Jeans", occasion: "Casual", expected: "good" },
  { top: "White T-Shirt", bottom: "Black Running Shorts", occasion: "Athletic", expected: "good" },
  { top: "Navy Polo", bottom: "Navy Chinos", occasion: "Business", expected: "good" },
  { top: "Black Dress Shirt", bottom: "Black Dress Pants", occasion: "Formal", expected: "good" },
  { top: "Gray Blazer", bottom: "Black Dress Pants", occasion: "Formal", expected: "good" },
  { top: "Blue Sweater", bottom: "Blue Jeans", occasion: "Date Night", expected: "good" },
  { top: "Red Tank Top", bottom: "Black Running Shorts", occasion: "Athletic", expected: "good" },
];

// Expected bad combinations
const badCombinations = [
  { top: "Gray Hoodie", bottom: "Black Dress Pants", occasion: "Formal", expected: "bad" },
  { top: "Red Tank Top", bottom: "Black Dress Pants", occasion: "Formal", expected: "bad" },
  { top: "Navy Polo", bottom: "Gray Sweatpants", occasion: "Business", expected: "bad" },
  { top: "Black Dress Shirt", bottom: "Khaki Shorts", occasion: "Formal", expected: "bad" },
  { top: "Gray Blazer", bottom: "Gray Sweatpants", occasion: "Formal", expected: "bad" },
];

async function runTests() {
  console.log("=".repeat(60));
  console.log("OUTFIT RECOMMENDATION ENGINE - TEST SUITE");
  console.log("=".repeat(60));
  console.log();

  const engine = new OutfitRecommendationEngine(testWardrobe);

  // Test good combinations
  console.log("📗 TESTING GOOD COMBINATIONS:");
  console.log("-".repeat(60));
  let goodPassed = 0;
  
  for (const combo of goodCombinations) {
    const results = await engine.recommend({ occasion: combo.occasion, maxResults: 100, minScore: 0 });
    const found = results.find(r => 
      r.top.name === combo.top && r.bottom.name === combo.bottom
    );
    
    const score = found?.score || 0;
    const passed = score >= 50;
    if (passed) goodPassed++;
    
    console.log(`${passed ? "✅" : "❌"} ${combo.top} + ${combo.bottom} (${combo.occasion})`);
    console.log(`   Score: ${score}/100 ${passed ? "" : "← SHOULD BE HIGHER"}`);
    if (found?.reasons.length) {
      console.log(`   Reasons: ${found.reasons.join(", ")}`);
    }
    if (!found && results.length > 0) {
      console.log(`   DEBUG: ${results.length} results, this combo missing. All results:`);
      results.forEach((r, i) => console.log(`     ${i+1}. ${r.top.name} + ${r.bottom.name} (${r.score})`));
    }
    console.log();
  }

  // Test bad combinations
  console.log("📕 TESTING BAD COMBINATIONS:");
  console.log("-".repeat(60));
  let badPassed = 0;
  
  for (const combo of badCombinations) {
    const results = await engine.recommend({ occasion: combo.occasion, maxResults: 20, minScore: 0 });
    const found = results.find(r => 
      r.top.name === combo.top && r.bottom.name === combo.bottom
    );
    
    const score = found?.score || 0;
    const passed = score < 50 || !found;
    if (passed) badPassed++;
    
    console.log(`${passed ? "✅" : "❌"} ${combo.top} + ${combo.bottom} (${combo.occasion})`);
    console.log(`   Score: ${score}/100 ${passed ? "(correctly low/filtered)" : "← SHOULD BE LOWER"}`);
    console.log();
  }

  // Summary
  console.log("=".repeat(60));
  console.log("TEST SUMMARY:");
  console.log("-".repeat(60));
  console.log(`Good combinations: ${goodPassed}/${goodCombinations.length} passed`);
  console.log(`Bad combinations: ${badPassed}/${badCombinations.length} passed`);
  console.log(`Overall accuracy: ${Math.round((goodPassed + badPassed) / (goodCombinations.length + badCombinations.length) * 100)}%`);
  console.log("=".repeat(60));

  // Test specific occasions
  console.log();
  console.log("🎯 TOP RECOMMENDATIONS BY OCCASION:");
  console.log("-".repeat(60));
  
  for (const occasion of ["Casual", "Athletic", "Formal", "Business", "Date Night"]) {
    console.log(`\n${occasion.toUpperCase()}:`);
    const results = await engine.recommend({ occasion, maxResults: 10, minScore: 0 });
    
    if (results.length === 0) {
      console.log("  No recommendations found (items may not match this occasion)");
    } else {
      results.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.top.name} + ${r.bottom.name} (${r.score}/100)`);
      });
      console.log(`  ... ${results.length} total results`);
    }
  }

  // Test color harmony
  console.log();
  console.log("🎨 COLOR HARMONY TEST:");
  console.log("-".repeat(60));
  
  const colorTests = [
    { colors1: ["gray"], colors2: ["khaki", "beige"], expected: "Neutral + Earth tone = Good" },
    { colors1: ["black"], colors2: ["white"], expected: "Classic contrast = Good" },
    { colors1: ["navy"], colors2: ["navy"], expected: "Monochromatic = Good" },
    { colors1: ["red"], colors2: ["green"], expected: "Complementary = Depends" },
    { colors1: ["blue"], colors2: ["orange"], expected: "Complementary = Good" },
  ];
  
  for (const test of colorTests) {
    const item1: WardrobeItemML = { id: "t1", name: "Top", colors: test.colors1 };
    const item2: WardrobeItemML = { id: "t2", name: "Bottom", colors: test.colors2 };
    
    // Create engine just to test color scoring
    const tempEngine = new OutfitRecommendationEngine([
      { ...item1, clothingType: "top", category: "shirt" },
      { ...item2, clothingType: "bottom", category: "pants" }
    ]);
    const results = await tempEngine.recommend({ occasion: "casual", maxResults: 1, minScore: 0 });
    
    console.log(`${test.colors1.join("/")} + ${test.colors2.join("/")}: ${results[0]?.score || 0}/100`);
    console.log(`  Expected: ${test.expected}`);
  }
}

// Direct pair test
async function testDirectPair() {
  console.log();
  console.log("🔬 DIRECT PAIR TESTS:");
  console.log("-".repeat(60));
  
  // Test 1: White T-Shirt + Blue Jeans (Casual)
  const tshirt: WardrobeItemML = { 
    id: "100", name: "White T-Shirt", clothingType: "top", 
    category: "t-shirt", colors: ["white"],
    occasions: ["Casual", "Athletic"], seasons: ["All"]
  };
  
  const jeans: WardrobeItemML = { 
    id: "101", name: "Blue Jeans", clothingType: "bottom", 
    category: "jeans", colors: ["blue"],
    occasions: ["Casual", "Going Out"], seasons: ["All"]
  };
  
  let miniEngine = new OutfitRecommendationEngine([tshirt, jeans]);
  let results = await miniEngine.recommend({ occasion: "Casual", maxResults: 1, minScore: 0 });
  console.log(`White T-Shirt + Blue Jeans (Casual): ${results[0]?.score || 0}/100`);

  // Test 2: T-Shirt + Running Shorts (Athletic)
  const tank: WardrobeItemML = { 
    id: "200", name: "Red Tank Top", clothingType: "top", 
    category: "tank", colors: ["red"],
    occasions: ["Athletic"], seasons: ["All"]
  };
  
  const runShorts: WardrobeItemML = { 
    id: "201", name: "Black Running Shorts", clothingType: "bottom", 
    category: "athletic shorts", colors: ["black"],
    occasions: ["Athletic"], seasons: ["All"]
  };
  
  miniEngine = new OutfitRecommendationEngine([tank, runShorts]);
  results = await miniEngine.recommend({ occasion: "Athletic", maxResults: 1, minScore: 0 });
  console.log(`Red Tank + Running Shorts (Athletic): ${results[0]?.score || 0}/100`);
  if (results[0]) console.log(`  Reasons: ${results[0].reasons.join(", ")}`);
  
  // Test 3: Navy Polo + Navy Chinos (Business)
  const polo: WardrobeItemML = { 
    id: "300", name: "Navy Polo", clothingType: "top", 
    category: "polo", colors: ["navy"],
    occasions: ["Business", "Casual"], seasons: ["All"]
  };
  
  const chinos: WardrobeItemML = { 
    id: "301", name: "Navy Chinos", clothingType: "bottom", 
    category: "chinos", colors: ["navy"],
    occasions: ["Business", "Casual"], seasons: ["All"]
  };
  
  miniEngine = new OutfitRecommendationEngine([polo, chinos]);
  results = await miniEngine.recommend({ occasion: "Business", maxResults: 1, minScore: 0 });
  console.log(`Navy Polo + Navy Chinos (Business): ${results[0]?.score || 0}/100`);
  if (results[0]) console.log(`  Reasons: ${results[0].reasons.join(", ")}`);
}

// Run the tests
(async () => {
  await runTests();
  await testDirectPair();
})();
