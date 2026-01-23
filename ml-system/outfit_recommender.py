from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum


class Category(Enum):
    TOP = "top"
    BOTTOM = "bottom"
    FOOTWEAR = "footwear"


@dataclass
class ClothingItem:
    """Wardrobe item - REQUIRED: id, category, color"""
    id: str
    category: Category
    color: str
    pattern: str = "solid"
    style: str = "casual"


@dataclass
class Outfit:
    """Complete outfit recommendation"""
    top: ClothingItem
    bottom: ClothingItem
    shoes: ClothingItem
    score: int
    reason: str


class OutfitRecommender:
    """Rule-based outfit recommendation system"""
    
    NEUTRALS = {"#000000", "#FFFFFF", "#808080", "#F5F5DC", "#000080", "#A52A2A"}
    
    OCCASION_STYLES = {
        "casual": ["casual", "athletic"],
        "formal": ["formal", "business"],
        "business": ["business", "formal"],
        "athletic": ["athletic", "casual"]
    }
    
    MIN_SCORE = 60
    
    def __init__(self, wardrobe: List[ClothingItem]):
        self.tops = [item for item in wardrobe if item.category == Category.TOP]
        self.bottoms = [item for item in wardrobe if item.category == Category.BOTTOM]
        self.shoes = [item for item in wardrobe if item.category == Category.FOOTWEAR]
    
    def recommend(self, occasion: str, max_results: int = 5) -> List[Outfit]:
        """Generate outfit recommendations for given occasion"""
        if not self._validate_wardrobe():
            return []
        
        outfits = []
        for top in self.tops:
            for bottom in self.bottoms:
                for shoes in self.shoes:
                    outfit = self._score_outfit(top, bottom, shoes, occasion)
                    if outfit.score >= self.MIN_SCORE:
                        outfits.append(outfit)
        
        outfits.sort(key=lambda x: x.score, reverse=True)
        return outfits[:max_results]
    
    def _score_outfit(self, top: ClothingItem, bottom: ClothingItem, 
                     shoes: ClothingItem, occasion: str) -> Outfit:
        """Score outfit based on color, pattern, and occasion rules"""
        score = 100
        reasons = []
        
        # Color constraint
        if not self._colors_match(top.color, bottom.color, shoes.color):
            score -= 20
            reasons.append("colors may clash")
        else:
            reasons.append("colors match well")
        
        # Pattern constraint
        patterns = [item.pattern for item in [top, bottom, shoes] if item.pattern != "solid"]
        if len(patterns) > 1:
            score -= 15
            reasons.append("too many patterns")
        
        # Occasion constraint
        styles = [top.style, bottom.style, shoes.style]
        if not self._matches_occasion(styles, occasion):
            score -= 25
            reasons.append(f"may not fit {occasion} occasion")
        else:
            reasons.append(f"appropriate for {occasion}")
        
        return Outfit(top, bottom, shoes, score, ", ".join(reasons))
    
    def _colors_match(self, color1: str, color2: str, color3: str) -> bool:
        """Check if three colors work together"""
        colors = [color1, color2, color3]
        neutral_count = sum(1 for c in colors if c in self.NEUTRALS)
        
        if neutral_count >= 2:
            return True
        if color1 == color2 == color3:
            return True
        if neutral_count == 1:
            non_neutrals = [c for c in colors if c not in self.NEUTRALS]
            if len(set(non_neutrals)) <= 2:
                return True
        
        return neutral_count > 0
    
    def _matches_occasion(self, styles: List[str], occasion: str) -> bool:
        """Check if styles match the occasion"""
        allowed_styles = self.OCCASION_STYLES.get(occasion, ["casual"])
        for style in styles:
            if style not in allowed_styles:
                return False
        return True
    
    def _validate_wardrobe(self) -> bool:
        """Check if wardrobe has minimum items for complete outfit"""
        return len(self.tops) >= 1 and len(self.bottoms) >= 1 and len(self.shoes) >= 1


def create_item_from_cv(cv_output: Dict, user_id: str) -> ClothingItem:
    """Convert CV output to ClothingItem"""
    category_map = {
        "top": Category.TOP,
        "bottom": Category.BOTTOM,
        "footwear": Category.FOOTWEAR
    }
    
    if "category" not in cv_output or "color_primary" not in cv_output:
        raise ValueError("Missing required fields: category and color_primary")
    
    return ClothingItem(
        id=f"{user_id}_{cv_output.get('item_id', 'unknown')}",
        category=category_map[cv_output["category"]],
        color=cv_output["color_primary"],
        pattern=cv_output.get("pattern", "solid"),
        style=cv_output.get("style", "casual")
    )


if __name__ == "__main__":
    print("=" * 60)
    print("FITTED - Outfit Recommender Demo")
    print("=" * 60)
    print()
    
    wardrobe = [
        ClothingItem("t1", Category.TOP, "#0066CC", "solid", "casual"),
        ClothingItem("t2", Category.TOP, "#FFFFFF", "solid", "casual"),
        ClothingItem("t3", Category.TOP, "#000000", "solid", "business"),
        ClothingItem("b1", Category.BOTTOM, "#000000", "solid", "casual"),
        ClothingItem("b2", Category.BOTTOM, "#0000FF", "solid", "casual"),
        ClothingItem("b3", Category.BOTTOM, "#808080", "solid", "business"),
        ClothingItem("s1", Category.FOOTWEAR, "#FFFFFF", "solid", "casual"),
        ClothingItem("s2", Category.FOOTWEAR, "#000000", "solid", "business"),
    ]
    
    print(f"Wardrobe: {len(wardrobe)} items\n")
    
    recommender = OutfitRecommender(wardrobe)
    
    for occasion in ["casual", "business"]:
        print(f"OCCASION: {occasion.upper()}")
        print("-" * 60)
        
        outfits = recommender.recommend(occasion, max_results=3)
        
        for i, outfit in enumerate(outfits, 1):
            print(f"\nOutfit #{i} (Score: {outfit.score}/100)")
            print(f"  Top: {outfit.top.color} {outfit.top.pattern}")
            print(f"  Bottom: {outfit.bottom.color} {outfit.bottom.pattern}")
            print(f"  Shoes: {outfit.shoes.color}")
            print(f"  Why: {outfit.reason}")
        
        print()
