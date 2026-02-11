/**
 * History Page Unit Tests
 * 
 * Testing Library: Jest + React Testing Library
 * 
 * Approach:
 * - Component rendering tests: Verify the page renders correctly with different states
 * - User interaction tests: Simulate clicks and verify expected behavior
 * - API integration tests: Mock fetch calls and verify data handling
 * - Filter functionality tests: Verify occasion filtering works correctly
 * 
 * We chose React Testing Library because:
 * 1. It encourages testing from the user's perspective (what they see and interact with)
 * 2. It integrates well with Jest and Next.js
 * 3. It provides utilities for async testing (waitFor, findBy queries)
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import HistoryPage from '@/app/(app)/history/page';

// Mock data for tests
const mockLikedOutfits = [
  {
    id: 'outfit-1',
    items: [
      { id: 'item-1', name: 'Blue Shirt', category: 'tops', colors: ['blue'], imagePath: 'mongo:abc123' },
      { id: 'item-2', name: 'Black Jeans', category: 'bottoms', colors: ['black'] },
    ],
    action: 'accepted',
    occasion: 'casual',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'outfit-2',
    items: [
      { id: 'item-3', name: 'White Dress Shirt', category: 'tops', colors: ['white'] },
      { id: 'item-4', name: 'Navy Slacks', category: 'bottoms', colors: ['navy'] },
    ],
    action: 'accepted',
    occasion: 'business',
    createdAt: new Date().toISOString(),
  },
];

const mockDislikedOutfits = [
  {
    id: 'outfit-3',
    items: [
      { id: 'item-5', name: 'Red T-Shirt', category: 'tops', colors: ['red'] },
      { id: 'item-6', name: 'Cargo Shorts', category: 'bottoms', colors: ['khaki'] },
    ],
    action: 'rejected',
    occasion: 'casual',
    createdAt: new Date().toISOString(),
  },
];

// Helper to setup fetch mock
function setupFetchMock(likedData = mockLikedOutfits, dislikedData = mockDislikedOutfits) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('action=accepted')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ interactions: likedData }),
      });
    }
    if (url.includes('action=rejected')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ interactions: dislikedData }),
      });
    }
    // Default response for other endpoints (DELETE, PATCH)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });
}

describe('History Page', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  describe('Rendering', () => {
    it('renders the page title and description', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      expect(screen.getByText('History')).toBeInTheDocument();
      expect(screen.getByText('Review your past outfit recommendations and feedback.')).toBeInTheDocument();
    });

    it('renders both Liked and Disliked tabs', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      // Use getByText with exact match to find tab buttons
      expect(screen.getByText('Liked')).toBeInTheDocument();
      expect(screen.getByText('Disliked')).toBeInTheDocument();
    });

    it('renders the occasion filter dropdown', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      expect(screen.getByLabelText(/filter by/i)).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('displays outfit cards after loading', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      expect(screen.getByText('Black Jeans')).toBeInTheDocument();
    });
  });

  describe('Tab Navigation', () => {
    it('shows liked outfits by default', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Liked outfit should be visible
      expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      
      // Disliked outfit should not be visible initially
      expect(screen.queryByText('Red T-Shirt')).not.toBeInTheDocument();
    });

    it('switches to disliked tab when clicked', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Click on Disliked tab (find button containing "Disliked" text)
      await act(async () => {
        const dislikedTab = screen.getByText('Disliked').closest('button');
        if (dislikedTab) fireEvent.click(dislikedTab);
      });
      
      // Now disliked outfit should be visible
      expect(screen.getByText('Red T-Shirt')).toBeInTheDocument();
      
      // Liked outfit should not be visible
      expect(screen.queryByText('Blue Shirt')).not.toBeInTheDocument();
    });
  });

  describe('Occasion Filter', () => {
    it('filters outfits by occasion', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Both casual and business outfits visible initially
      expect(screen.getByText('Blue Shirt')).toBeInTheDocument(); // casual
      expect(screen.getByText('White Dress Shirt')).toBeInTheDocument(); // business
      
      // Filter by business
      await act(async () => {
        const filterSelect = screen.getByRole('combobox');
        fireEvent.change(filterSelect, { target: { value: 'business' } });
      });
      
      // Only business outfit should be visible
      expect(screen.queryByText('Blue Shirt')).not.toBeInTheDocument();
      expect(screen.getByText('White Dress Shirt')).toBeInTheDocument();
    });

    it('shows empty state when filter has no matches', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Filter by formal (no outfits match)
      await act(async () => {
        const filterSelect = screen.getByRole('combobox');
        fireEvent.change(filterSelect, { target: { value: 'formal' } });
      });
      
      // Should show empty state message
      expect(screen.getByText(/no liked outfits found for/i)).toBeInTheDocument();
    });
  });

  describe('Outfit Card Actions', () => {
    it('opens dropdown menu when clicking more options button', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Find and click the more options button (vertical dots)
      await act(async () => {
        const moreButtons = screen.getAllByTitle('More options');
        fireEvent.click(moreButtons[0]);
      });
      
      // Dropdown should show move and remove options
      expect(screen.getByText('Move to Disliked')).toBeInTheDocument();
      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('calls API to remove outfit when Remove is clicked', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Open dropdown
      await act(async () => {
        const moreButtons = screen.getAllByTitle('More options');
        fireEvent.click(moreButtons[0]);
      });
      
      // Click Remove
      await act(async () => {
        const removeButton = screen.getByText('Remove');
        fireEvent.click(removeButton);
      });
      
      // Verify DELETE API was called
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/interactions?id='),
          expect.objectContaining({ method: 'DELETE' })
        );
      });
    });

    it('calls API to move outfit when Move is clicked', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Open dropdown
      await act(async () => {
        const moreButtons = screen.getAllByTitle('More options');
        fireEvent.click(moreButtons[0]);
      });
      
      // Click Move to Disliked
      await act(async () => {
        const moveButton = screen.getByText('Move to Disliked');
        fireEvent.click(moveButton);
      });
      
      // Verify PATCH API was called
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/interactions',
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('rejected'),
          })
        );
      });
    });
  });

  describe('Empty States', () => {
    it('shows empty state when no liked outfits', async () => {
      setupFetchMock([], mockDislikedOutfits);
      
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText("You haven't liked any outfits yet.")).toBeInTheDocument();
      });
    });

    it('shows empty state when no disliked outfits', async () => {
      setupFetchMock(mockLikedOutfits, []);
      
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Switch to disliked tab
      await act(async () => {
        const dislikedTab = screen.getByText('Disliked').closest('button');
        if (dislikedTab) fireEvent.click(dislikedTab);
      });
      
      expect(screen.getByText("You haven't disliked any outfits yet.")).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('shows error message when API fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API Error'));
      
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText(/failed to load your outfit history/i)).toBeInTheDocument();
      });
    });

    it('shows retry button on error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API Error'));
      
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });
    });
  });

  describe('Image Display', () => {
    it('converts imagePath to image URL correctly', async () => {
      await act(async () => {
        render(<HistoryPage />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
      });
      
      // Check that image with correct src is rendered
      const images = screen.getAllByRole('img');
      const blueShirtImage = images.find(img => img.getAttribute('alt') === 'Blue Shirt');
      
      expect(blueShirtImage).toHaveAttribute('src', '/api/images/abc123');
    });
  });
});
