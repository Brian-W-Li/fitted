## Testing Libraries Evaluated
- Frontend: Jest + React Testing Library
- Backend (Node): Jest
- Backend (Python): pytest

## Why These Choices
- Fast setup, consistent testing libraries with good ecosystem support, aligns with stack

## Tests Implemented
- API Logic Tests
  - Action validation (accepted/rejected)
  - Item IDs validation
  - Date filtering (past month)
  - Query building
  - Response formatting
  - imagePath to URL conversion
- UI component tests
  - Rendering (title, tabs, filter dropdown, outfit cards)
  - Tab navigation (switching between liked/disliked in history tab)
  - Occasion filtering (filter by occasion, empty states)
  - Dropdown actions (open menu, remove outfit, move outfit)
  - Empty states (no liked/disliked outfits)
  - Error handling (API failures, retry button)

  
  

## How to Run Tests
- Frontend: npm run test
- Backend (Node): npm run test
- Backend (Python): pytest
