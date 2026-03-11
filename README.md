# Fitted

## Description
Our web app will allow users to store clothes from their wardrobe and then recommend outfit for the day.

## More Details
Our ideal users are people in all age ranges that struggle with picking an outfit for the day. Maybe 15-25yr olds.  

**User roles -** just a regular user that has their own wardrobe and suggestions based on that  

**Approach -**  
A user will be able to click pictures of their clothes and add them to their wardrobe.  
Once they add a few pieces, our ML model will kick in and start recommending pieces that go together.  
They can also then choose to favorite outfits so our recommendation model learns and suggests similar outfit  

**Goal -** Help users save that extra precious time in the morning (when they are already late to school/work) by not having to spend 10-15 mins on just deciding what to wear  


## Technologies

Next.js, Node.js/Python, Vercel, MongoDB (NoSQL DB), Firebase


# Installation

## Prerequisites

- Node.js
- pnpm or npm
- Git
- Firebase
- MongoDB
- OpenAI

## Dependencies

- next, react, react-dom — App and UI
- firebase, firebase-admin — Auth (client + server token verification)
- mongoose, mongodb — MongoDB and models (User, WardrobeItem, OutfitInteraction)
- openai — Outfit recommendations
- tailwindcss — Styling
- typescript, eslint — Types and linting


## Installation Steps

# Live App and local deployment

You can access the deployed app here:
https://fitted-outfits.vercel.app/

Or run it locally:

`git clone <repo-url>`  
`cd pj12-outfit-recommender/fitted`  
`pnpm install`  or `npm install`
create a .env.local and add the API keys
`pnpm dev` 
Open in your browser at https://localhost:3000

# Functionality

- Sign in — /signin or /signup (Firebase, e.g. Google); user synced to MongoDB.
- Wardrobe — Add/edit/delete items (name, category, colors, fit, size, etc.).
- Home — Pick occasion, get outfit suggestions (OpenAI); accept/reject stored as interactions.
- History — Past outfit interactions (In Progress feature).
- Account — Profile and optional age/gender.

# Contributing

Fork it!

Create your feature branch: `git checkout -b my-new-feature`

Commit your changes: `git commit -am 'Add some feature'`

Push to the branch: `git push origin my-new-feature`

Submit a pull request :D

