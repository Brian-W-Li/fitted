/**
 * Interactions API Unit Tests
 * 
 * Testing Library: Jest
 * 
 * Approach:
 * - Unit tests for API helper functions and validation logic
 * - These tests focus on the business logic rather than HTTP handling
 * - Full integration tests would require a test database setup
 * 
 * Note: Testing Next.js API routes directly requires additional setup.
 * These tests focus on validating the logic that the routes use.
 */

describe('Interactions API Logic', () => {
  describe('Action Validation', () => {
    const validActions = ['accepted', 'rejected'];

    it('accepts "accepted" as valid action', () => {
      expect(validActions.includes('accepted')).toBe(true);
    });

    it('accepts "rejected" as valid action', () => {
      expect(validActions.includes('rejected')).toBe(true);
    });

    it('rejects invalid actions', () => {
      expect(validActions.includes('invalid')).toBe(false);
      expect(validActions.includes('liked')).toBe(false);
      expect(validActions.includes('')).toBe(false);
    });
  });

  describe('Item IDs Validation', () => {
    function validateItemIds(itemIds: unknown): boolean {
      return Array.isArray(itemIds) && itemIds.length > 0;
    }

    it('accepts valid array of item IDs', () => {
      expect(validateItemIds(['item-1', 'item-2'])).toBe(true);
    });

    it('rejects empty array', () => {
      expect(validateItemIds([])).toBe(false);
    });

    it('rejects non-array values', () => {
      expect(validateItemIds(null)).toBe(false);
      expect(validateItemIds(undefined)).toBe(false);
      expect(validateItemIds('item-1')).toBe(false);
      expect(validateItemIds(123)).toBe(false);
    });
  });

  describe('Date Filter (Past Month)', () => {
    function getOneMonthAgo(): Date {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      return oneMonthAgo;
    }

    it('returns a date one month in the past', () => {
      const now = new Date();
      const oneMonthAgo = getOneMonthAgo();
      
      // Should be approximately 30 days ago
      const diffInMs = now.getTime() - oneMonthAgo.getTime();
      const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
      
      expect(diffInDays).toBeGreaterThanOrEqual(28);
      expect(diffInDays).toBeLessThanOrEqual(31);
    });

    it('filters interactions correctly', () => {
      const oneMonthAgo = getOneMonthAgo();
      
      const recentInteraction = { createdAt: new Date() };
      const oldInteraction = { createdAt: new Date('2020-01-01') };
      
      expect(recentInteraction.createdAt >= oneMonthAgo).toBe(true);
      expect(oldInteraction.createdAt >= oneMonthAgo).toBe(false);
    });
  });

  describe('Query Building', () => {
    function buildQuery(userId: string, action?: string | null) {
      const query: Record<string, unknown> = { user: userId };
      
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      query.createdAt = { $gte: oneMonthAgo };
      
      if (action && ['accepted', 'rejected'].includes(action)) {
        query.action = action;
      } else {
        query.action = { $in: ['accepted', 'rejected'] };
      }
      
      return query;
    }

    it('includes user ID in query', () => {
      const query = buildQuery('user-123');
      expect(query.user).toBe('user-123');
    });

    it('includes date filter in query', () => {
      const query = buildQuery('user-123');
      expect(query.createdAt).toBeDefined();
      expect((query.createdAt as { $gte: Date }).$gte).toBeInstanceOf(Date);
    });

    it('filters by specific action when provided', () => {
      const query = buildQuery('user-123', 'accepted');
      expect(query.action).toBe('accepted');
    });

    it('filters by both actions when no filter provided', () => {
      const query = buildQuery('user-123', null);
      expect(query.action).toEqual({ $in: ['accepted', 'rejected'] });
    });

    it('ignores invalid action filters', () => {
      const query = buildQuery('user-123', 'invalid');
      expect(query.action).toEqual({ $in: ['accepted', 'rejected'] });
    });
  });

  describe('Response Formatting', () => {
    function formatInteraction(interaction: {
      _id: { toString: () => string };
      items: Array<{
        _id: { toString: () => string };
        name: string;
        category: string;
        colors: string[];
        imagePath?: string;
      }>;
      action: string;
      context?: { occasion?: string };
      createdAt: Date;
    }) {
      return {
        id: interaction._id.toString(),
        items: interaction.items.map((item) => ({
          id: item._id.toString(),
          name: item.name,
          category: item.category,
          colors: item.colors || [],
          imagePath: item.imagePath,
        })),
        action: interaction.action,
        occasion: interaction.context?.occasion || 'casual',
        createdAt: interaction.createdAt,
      };
    }

    it('formats interaction correctly', () => {
      const mockInteraction = {
        _id: { toString: () => 'interaction-1' },
        items: [
          {
            _id: { toString: () => 'item-1' },
            name: 'Blue Shirt',
            category: 'tops',
            colors: ['blue'],
            imagePath: 'mongo:abc123',
          },
        ],
        action: 'accepted',
        context: { occasion: 'business' },
        createdAt: new Date('2024-01-15'),
      };

      const formatted = formatInteraction(mockInteraction);

      expect(formatted.id).toBe('interaction-1');
      expect(formatted.items[0].id).toBe('item-1');
      expect(formatted.items[0].name).toBe('Blue Shirt');
      expect(formatted.items[0].imagePath).toBe('mongo:abc123');
      expect(formatted.action).toBe('accepted');
      expect(formatted.occasion).toBe('business');
    });

    it('defaults occasion to casual when not provided', () => {
      const mockInteraction = {
        _id: { toString: () => 'interaction-1' },
        items: [],
        action: 'accepted',
        context: undefined,
        createdAt: new Date(),
      };

      const formatted = formatInteraction(mockInteraction);
      expect(formatted.occasion).toBe('casual');
    });

    it('handles missing colors array', () => {
      const mockInteraction = {
        _id: { toString: () => 'interaction-1' },
        items: [
          {
            _id: { toString: () => 'item-1' },
            name: 'Test Item',
            category: 'tops',
            colors: undefined as unknown as string[],
          },
        ],
        action: 'accepted',
        createdAt: new Date(),
      };

      const formatted = formatInteraction(mockInteraction);
      expect(formatted.items[0].colors).toEqual([]);
    });
  });

  describe('imagePath to URL Conversion', () => {
    function imageUrlFromPath(imagePath?: string): string | null {
      if (!imagePath) return null;
      if (imagePath.startsWith('mongo:')) {
        const imageId = imagePath.slice('mongo:'.length);
        return `/api/images/${imageId}`;
      }
      return null;
    }

    it('converts mongo: prefix to API URL', () => {
      expect(imageUrlFromPath('mongo:abc123')).toBe('/api/images/abc123');
    });

    it('returns null for undefined imagePath', () => {
      expect(imageUrlFromPath(undefined)).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(imageUrlFromPath('')).toBe(null);
    });

    it('returns null for non-mongo paths', () => {
      expect(imageUrlFromPath('http://example.com/image.jpg')).toBe(null);
      expect(imageUrlFromPath('local:abc123')).toBe(null);
    });

    it('handles various image IDs', () => {
      expect(imageUrlFromPath('mongo:123')).toBe('/api/images/123');
      expect(imageUrlFromPath('mongo:abc-def-ghi')).toBe('/api/images/abc-def-ghi');
      expect(imageUrlFromPath('mongo:507f1f77bcf86cd799439011')).toBe('/api/images/507f1f77bcf86cd799439011');
    });
  });
});

describe('Occasion Filter Logic', () => {
  const OCCASIONS = [
    { value: 'all', label: 'All Occasions' },
    { value: 'casual', label: 'Casual' },
    { value: 'business', label: 'Business' },
    { value: 'formal', label: 'Formal' },
    { value: 'date night', label: 'Date Night' },
  ];

  function filterByOccasion<T extends { occasion: string }>(
    items: T[],
    filter: string
  ): T[] {
    if (filter === 'all') return items;
    return items.filter(
      (item) => item.occasion.toLowerCase() === filter.toLowerCase()
    );
  }

  const mockOutfits = [
    { id: '1', occasion: 'casual' },
    { id: '2', occasion: 'business' },
    { id: '3', occasion: 'casual' },
    { id: '4', occasion: 'formal' },
  ];

  it('returns all items when filter is "all"', () => {
    const result = filterByOccasion(mockOutfits, 'all');
    expect(result.length).toBe(4);
  });

  it('filters by casual occasion', () => {
    const result = filterByOccasion(mockOutfits, 'casual');
    expect(result.length).toBe(2);
    expect(result.every((o) => o.occasion === 'casual')).toBe(true);
  });

  it('filters by business occasion', () => {
    const result = filterByOccasion(mockOutfits, 'business');
    expect(result.length).toBe(1);
    expect(result[0].occasion).toBe('business');
  });

  it('is case insensitive', () => {
    const result = filterByOccasion(mockOutfits, 'CASUAL');
    expect(result.length).toBe(2);
  });

  it('returns empty array when no matches', () => {
    const result = filterByOccasion(mockOutfits, 'date night');
    expect(result.length).toBe(0);
  });

  it('includes all expected occasion options', () => {
    const values = OCCASIONS.map((o) => o.value);
    expect(values).toContain('all');
    expect(values).toContain('casual');
    expect(values).toContain('business');
    expect(values).toContain('formal');
    expect(values).toContain('date night');
  });
});
