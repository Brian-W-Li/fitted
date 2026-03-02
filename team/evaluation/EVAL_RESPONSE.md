# Evaluation Response

### 1. Decisions regarding USER_FEEDBACK_NEEDS.md

Performance (Loading Time): The 3+ minute loading time is unacceptable. We have never encountered this before but realized that it only happens the first time a user uses the CV analysis. If we have time, we plan to introduce loading states with progress indicators. 

More Descriptive Error Messages: We will replace generic "Something went wrong" messages with specific error codes and actionable suggestions (e.g., invalid API key, network failure, image parsing issue).

### 2. Additional Decisions
The other team understood how to use the CV analysis and adding/deleting items from the wardrobe. The AI implementation could be improved and we are planning to make these changes:
- Add one-piece clothing items such as dresses.
- Better Category Labels: We will improve classification logic and refine prompts/models to generate more accurate and descriptive labels.
- Remove the ML model we created and solely use GPT for outfit recommendations.
- Add layering of clothing items

### 3. Effectiveness & Robustness

The app’s robustness is currently limited by ocassional slow performance and unreliable AI integration. We will improve error handling and the prompting for the GPT model to ensure the app remains usable and stable. The UI/UX is perfeclty fine and easy to navigate. 

### 4. Deployment & Repo Organization

The deployment went smoothly for the other team. There was a small problem with using OpenAI's API key, but we were able to resolve it quickly. 

### 5. Final Closing Thoughts

Reviewers appreciated the overall concept. The most impactful improvement is stable AI integration and changing out schema to allow for dresses and layering. We agree these are foundational and will prioritize them before adding new features.
