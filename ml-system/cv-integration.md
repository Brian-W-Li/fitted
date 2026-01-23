# Computer Vision → ML Integration

## What CV needs to provide for now:

When a user uploads a clothing photo, your CV pipeline should return JSON with these fields:

### **Required Fields:**

```json
{
  "category": "top",
  "color_primary": "#0066CC"
}
```

| Field | Type | Values | Example |
|-------|------|--------|---------|
| `category` | string | "top", "bottom", "footwear" | "top" |
| `color_primary` | string | Hex color code | "#0066CC" |

### **Optional Fields (not compulsory but good to have):**

```json
{
  "pattern": "solid",
  "style": "casual"
}
```

| Field | Type | Values | Example |
|-------|------|--------|---------|
| `pattern` | string | "solid", "striped", "plaid", "floral" | "solid" |
| `style` | string | "casual", "formal", "athletic", "business" | "casual" |

---

## Category Classification

**What each category means:**

- **`top`** - Shirts, t-shirts, blouses, sweaters, hoodies
- **`bottom`** - Pants, jeans, shorts, skirts
- **`footwear`** - Shoes, sneakers, boots, sandals

**Decision tree:**
```
Covers torso/chest? → top
Covers legs? → bottom
Goes on feet? → footwear
```

---

## Color Extraction

**What we need:**
- The most dominant color in the item
- Format: Hex code (e.g., "#FF5733")

**Tips:**
- Ignore background
- Focus only on the garment
- Common colors: black (#000000), white (#FFFFFF), blue (#0000FF), red (#FF0000)

---

