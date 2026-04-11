import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface IntentSpec {
  description: string;
  filePaths: string[];
  functionNames: string[];
  priority: 'blocking' | 'normal' | 'background';
  rationale: string;
}

export async function decomposeTask(prompt: string, repoContext?: string): Promise<IntentSpec[]> {
  try {
    return await decomposeWithClaude(prompt, repoContext);
  } catch (err: any) {
    // Fall back to mock if API is unavailable (no credits, no key, network issue)
    const msg = err?.message ?? String(err);
    if (msg.includes('credit') || msg.includes('401') || msg.includes('API key') || msg.includes('billing') || msg.includes('404') || msg.includes('not_found')) {
      console.warn('Anthropic API unavailable, using mock planner:', msg.split('\n')[0]);
      return decomposeWithMock(prompt);
    }
    throw err;
  }
}

// ── Real Claude decomposition ─────────────────────────────────────────────────

async function decomposeWithClaude(prompt: string, repoContext?: string): Promise<IntentSpec[]> {
  const context = repoContext ? `\nRepo context: ${repoContext}` : '';

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a technical project planner for a software team that includes both human developers and AI coding agents.

Decompose this development task into 2-5 concrete, non-overlapping coding intents that can be worked on in parallel or sequence.${context}

Task: "${prompt}"

Return ONLY a valid JSON array with no markdown fencing:
[
  {
    "description": "specific, actionable coding task (one sentence)",
    "filePaths": ["realistic/relative/path.ts"],
    "functionNames": ["functionToModify"],
    "priority": "blocking",
    "rationale": "why this priority level"
  }
]

Priority rules:
- "blocking": foundational work others depend on — do first
- "normal": can run in parallel with other normal tasks
- "background": cleanup, docs, tests — do last

Keep filePaths realistic for a TypeScript project.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]) as IntentSpec[];
}

// ── Mock decomposition (keyword-based, no API needed) ─────────────────────────

function decomposeWithMock(prompt: string): IntentSpec[] {
  const p = prompt.toLowerCase();

  const intents: IntentSpec[] = [];

  // Auth / login patterns
  if (p.includes('auth') || p.includes('login') || p.includes('oauth') || p.includes('jwt') || p.includes('token')) {
    intents.push({
      description: 'Set up authentication types and interfaces',
      filePaths: ['src/auth/types.ts'],
      functionNames: ['TokenPayload', 'AuthRequest'],
      priority: 'blocking',
      rationale: 'Types must exist before implementation can reference them',
    });
    intents.push({
      description: 'Implement token verification and session creation middleware',
      filePaths: ['src/auth/middleware.ts'],
      functionNames: ['verifyToken', 'createSession'],
      priority: 'normal',
      rationale: 'Core auth logic, depends on types being defined first',
    });
    if (p.includes('oauth')) {
      intents.push({
        description: 'Add OAuth callback handler and token exchange',
        filePaths: ['src/auth/oauth.ts'],
        functionNames: ['handleCallback', 'exchangeCode'],
        priority: 'normal',
        rationale: 'Can be developed in parallel with middleware',
      });
    }
  }

  // API / routes patterns
  if (p.includes('api') || p.includes('endpoint') || p.includes('route') || p.includes('rest')) {
    intents.push({
      description: 'Define API route handlers and request validation schemas',
      filePaths: ['src/api/routes.ts', 'src/api/validators.ts'],
      functionNames: ['registerRoutes', 'validateRequest'],
      priority: 'blocking',
      rationale: 'Route definitions needed before adding business logic',
    });
    intents.push({
      description: 'Implement controller logic and error handling',
      filePaths: ['src/api/controllers.ts'],
      functionNames: ['handleRequest', 'formatError'],
      priority: 'normal',
      rationale: 'Business logic after routes are defined',
    });
  }

  // Database patterns
  if (p.includes('database') || p.includes('db') || p.includes('schema') || p.includes('model') || p.includes('migration')) {
    intents.push({
      description: 'Define database schema and run migrations',
      filePaths: ['src/db/schema.ts', 'src/db/migrations/'],
      functionNames: ['initDb', 'migrate'],
      priority: 'blocking',
      rationale: 'Schema must exist before any data layer code',
    });
    intents.push({
      description: 'Implement data access layer with CRUD operations',
      filePaths: ['src/db/repository.ts'],
      functionNames: ['findById', 'create', 'update', 'delete'],
      priority: 'normal',
      rationale: 'Can proceed once schema is finalized',
    });
  }

  // UI / frontend patterns
  if (p.includes('ui') || p.includes('component') || p.includes('page') || p.includes('frontend') || p.includes('react')) {
    intents.push({
      description: 'Create reusable UI components and styling',
      filePaths: ['src/components/'],
      functionNames: [],
      priority: 'normal',
      rationale: 'Components can be built independently',
    });
    intents.push({
      description: 'Wire up state management and API integration',
      filePaths: ['src/store/', 'src/hooks/'],
      functionNames: ['useStore', 'useApi'],
      priority: 'normal',
      rationale: 'Can proceed in parallel with component development',
    });
  }

  // Test patterns
  if (p.includes('test') || p.includes('spec') || p.includes('coverage')) {
    intents.push({
      description: 'Write unit tests for core business logic',
      filePaths: ['src/__tests__/'],
      functionNames: [],
      priority: 'background',
      rationale: 'Tests added after implementation is stable',
    });
  }

  // Refactor patterns
  if (p.includes('refactor') || p.includes('rewrite') || p.includes('clean')) {
    intents.push({
      description: 'Identify and extract shared utilities and types',
      filePaths: ['src/shared/types.ts', 'src/utils/'],
      functionNames: [],
      priority: 'blocking',
      rationale: 'Shared abstractions must be stable before refactoring dependents',
    });
    intents.push({
      description: 'Refactor existing modules to use new abstractions',
      filePaths: ['src/'],
      functionNames: [],
      priority: 'normal',
      rationale: 'Module-by-module refactor after shared types are ready',
    });
  }

  // Generic fallback — always produce something useful
  if (intents.length === 0) {
    const words = prompt.split(' ').slice(0, 4).join(' ');
    intents.push({
      description: `Define types and interfaces for: ${words}`,
      filePaths: ['src/types.ts'],
      functionNames: [],
      priority: 'blocking',
      rationale: 'Type definitions needed before implementation',
    });
    intents.push({
      description: `Implement core logic for: ${words}`,
      filePaths: ['src/index.ts'],
      functionNames: ['main'],
      priority: 'normal',
      rationale: 'Main implementation once types are defined',
    });
    intents.push({
      description: 'Add error handling and input validation',
      filePaths: ['src/validation.ts'],
      functionNames: ['validate'],
      priority: 'background',
      rationale: 'Hardening after core logic works',
    });
  }

  return intents;
}
