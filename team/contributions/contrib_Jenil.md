### ML Recommendation System
Built the core recommendation engine from scratch. Started with a rule-based approach using color theory and occasion matching, then upgraded it to use embeddings, a neural network, and collaborative filtering so it learns from user likes/dislikes over time.

### ONNX Model
Experimented with an ONNX neural network model to improve outfit matching. It worked locally but had to be removed because Vercel doesn't support the native bindings it needs. The TypeScript ML engine handles everything now.

### GPT Integration
Refactored the system to use OpenAI's GPT for smarter recommendations. Added prompt engineering with fashion knowledge (color theory, layering, accessories) and built a chat feature so users can talk to the AI stylist.

### UI Improvements
Made the logo clickable to go home
Fixed outfit display order (Top → Bottom → Jacket)
Improved image cards and simplified occasion options
Added top/bottom selector when adding clothes

### Other Work
CV metadata integration for auto-detecting clothing attributes
Jest tests for the recommendation engine
Fixed Vercel deployment issues
Scrum notes and team setup docs
