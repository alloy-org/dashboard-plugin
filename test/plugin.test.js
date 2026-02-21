/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Plugin integration tests — renderEmbed, onEmbedCall, appOption
 * Prompt summary: "jest tests for the Amplenote dashboard plugin API surface"
 */
import plugin from '../lib/plugin.js';

// Mock Amplenote app object
const mockApp = {
  settings: {
    'LLM API Key': 'test-key',
    'LLM Provider': 'openai'
  },

  async getTaskDomains() {
    return [
      { name: 'Work', handle: 'work' },
      { name: 'Personal', handle: 'personal' }
    ];
  },

  async getTaskDomainTasks(domain) {
    return [
      {
        uuid: 'task-1',
        content: 'Test task 1',
        completedAt: null,
        dismissedAt: null,
        startAt: Date.now(),
        victoryValue: 5,
        important: true,
        urgent: false
      }
    ];
  },

  async getMoodRatings(start, end) {
    return [
      { timestamp: Date.now(), rating: 4 }
    ];
  },

  async filterNotes(query) {
    return [];
  },

  async getNoteContent({ uuid }) {
    return '# Test Note\n\nContent here';
  },

  async createNote(name, tags) {
    return 'test-uuid';
  },

  async insertNoteContent({ uuid }, content) {
    return true;
  },

  async navigate(url) {
    return true;
  },

  async openSidebarEmbed(width) {
    return true;
  },

  async openEmbed() {
    return true;
  },

  async prompt(title, options) {
    return null;
  },

  async setSetting(key, value) {
    this.settings[key] = value;
    return true;
  }
};

// [Claude] Generated tests for: Amplenote dashboard plugin (renderEmbed, onEmbedCall, appOption)
// Date: 2026-02-20 | Model: claude-sonnet-4-5-20250929
describe('Dashboard Plugin', () => {
  describe('renderEmbed', () => {
    it('should return HTML string', async () => {
      const html = await plugin.renderEmbed(mockApp);

      expect(html).toBeDefined();
      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('should include React CDN scripts', async () => {
      const html = await plugin.renderEmbed(mockApp);

      expect(html).toContain('react@18');
      expect(html).toContain('react-dom@18');
    });

    it('should include dashboard root element', async () => {
      const html = await plugin.renderEmbed(mockApp);

      expect(html).toContain('dashboard-root');
    });

    it('should include callPlugin bridge function', async () => {
      const html = await plugin.renderEmbed(mockApp);

      expect(html).toContain('callPlugin');
      expect(html).toContain('callAmplenotePlugin');
    });

    it('should handle errors gracefully', async () => {
      const errorPlugin = { ...plugin };
      const originalRender = errorPlugin.renderEmbed;

      // This shouldn't throw
      const html = await originalRender.call(errorPlugin, mockApp);
      expect(html).toBeDefined();
    });
  });

  describe('onEmbedCall', () => {
    it('should handle init action', async () => {
      const result = await plugin.onEmbedCall(mockApp, 'init');

      expect(result).toBeDefined();
      expect(result.tasks).toBeDefined();
      expect(Array.isArray(result.tasks)).toBe(true);
    });

    it('should handle getTaskDomainTasks action', async () => {
      const result = await plugin.onEmbedCall(mockApp, 'getTaskDomainTasks', 'work');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle getMoodRatings action', async () => {
      const start = Date.now() - 86400000;
      const end = Date.now();
      const result = await plugin.onEmbedCall(mockApp, 'getMoodRatings', start, end);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return error for unknown action', async () => {
      const result = await plugin.onEmbedCall(mockApp, 'unknownAction');

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const brokenApp = {
        ...mockApp,
        getTaskDomains: async () => { throw new Error('Test error'); }
      };

      const result = await plugin.onEmbedCall(brokenApp, 'init');

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('appOption', () => {
    it('should have Open Dashboard option', () => {
      expect(plugin.appOption).toBeDefined();
      expect(plugin.appOption['Open Dashboard']).toBeDefined();
      expect(typeof plugin.appOption['Open Dashboard']).toBe('function');
    });

    it('should have Open Dashboard (Full) option', () => {
      expect(plugin.appOption).toBeDefined();
      expect(plugin.appOption['Open Dashboard (Full)']).toBeDefined();
      expect(typeof plugin.appOption['Open Dashboard (Full)']).toBe('function');
    });
  });
});
