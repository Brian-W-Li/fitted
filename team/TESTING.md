## Testing Libraries Evaluated
- Frontend: Jest + React Testing Library
- Backend (Node): Jest
- Backend (Python): pytest

## Why These Choices
- Fast setup, consistent testing libraries with good ecosystem support, aligns with stack

## Tests Implemented
We implemented unit tests primarily for API logic and helper functionality
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

## Unit test plans going forward
We plan to continue using Jest for unit testing core logic components because they are fast and effective.
Future areas for unit testing include additional validation logic and data transformation utilities.

## Higher Level testing
We did both component and integration tests

Component tests (react testing lib)
We implemented UI component tests that validate behavior across multiple elements
including rendering, tab navigation, dropdown actions, and error handling.

Integration tests (Recommendation system)
We implemented integration tests for the recommendation system testing interation between 'OutfitRecommendationEngine' and 'PairScorer', and validating recommendation output structure and correctness.

## Higher Level testing plans going forward
We plan to continue doing component testing using react and integration testing for core system flows. Component tests allow us to test components in more isolation without requiring full end-to-end tests. Integration tests ensure key modules are functioning correctly.
We will consider adding end-to-end testing in the future once the ML fully comes online.
  
  

## How to Run Tests
- Frontend: npm run test
- Backend (Node): npm run test
- Backend (Python): pytest
