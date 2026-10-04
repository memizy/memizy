import { describe, it, expect } from 'vitest';
import { OQSEActionSchema, FeatureFlagSchema, ManifestCapabilitiesSchema, OQSEManifestSchema, safeValidateOQSEManifest, validateOQSEManifest } from './manifestValidation';
import { formatOQSEErrors } from './utils';

describe('Manifest Validation Schemas', () => {
  it('OQSEActionSchema: allows official actions and x- prefixes', () => {
    expect(OQSEActionSchema.safeParse('render').success).toBe(true); // Official
    expect(OQSEActionSchema.safeParse('x-custom-action').success).toBe(true); // Custom
    expect(OQSEActionSchema.safeParse('unknown').success).toBe(false); // Invalid
  });

  it('FeatureFlagSchema: allows official features and x- prefixes', () => {
    expect(FeatureFlagSchema.safeParse('markdown').success).toBe(true); // Official
    expect(FeatureFlagSchema.safeParse('x-experimental-feature').success).toBe(true); // Custom
    expect(FeatureFlagSchema.safeParse('randomFeature').success).toBe(false); // Invalid
  });

  it('ManifestCapabilitiesSchema: requires at least one action', () => {
    const validManifest = { actions: ['validate'], features: [] };
    expect(ManifestCapabilitiesSchema.safeParse(validManifest).success).toBe(true);

    const invalidManifest = { actions: [], features: [] };
    const result = ManifestCapabilitiesSchema.safeParse(invalidManifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/must support at least one action/i);
    }
  });

  it('OQSEManifestSchema: fails when minOqseVersion > maxOqseVersion', () => {
    const invalidManifest = {
      version: "1.0",
      id: "https://example.org/apps/test-app",
      appName: "Test App",
      minOqseVersion: "2.0",
      maxOqseVersion: "1.0",
      capabilities: { actions: ["render"], features: [], types: ["*"] }
    };
    
    const result = OQSEManifestSchema.safeParse(invalidManifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.message.includes('not be greater than'))).toBe(true);
    }
  });

  it('OQSEManifestSchema: succeeds with valid version boundaries (min < max)', () => {
    const validManifest = {
      version: "1.0",
      id: "https://example.org/apps/test-app",
      appName: "Test App",
      minOqseVersion: "0.1",
      maxOqseVersion: "1.99",
      capabilities: { actions: ["render"], features: [], types: ["*"] }
    };
    
    const result = OQSEManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it('OQSEManifestSchema: accepts absolute URL and URN UUID manifest IDs', () => {
    const baseManifest = {
      version: '1.0',
      appName: 'Test App',
      capabilities: { actions: ['render'], features: [], types: ['*'] },
    };

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        id: 'https://example.org/apps/test-app',
      }).success
    ).toBe(true);

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        id: 'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
      }).success
    ).toBe(true);
  });

  it('OQSEManifestSchema: strictly rejects invalid id formats', () => {
    const baseManifest = {
      version: '1.0',
      appName: 'Test App',
      capabilities: { actions: ['render'], features: [], types: ['*'] },
    };

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        id: 'just-a-string',
      }).success
    ).toBe(false);

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        id: 'invalid-uuid',
      }).success
    ).toBe(false);
  });

  it('OQSEManifestSchema: allows non-SemVer pluginVersion values', () => {
    const baseManifest = {
      version: '1.0',
      id: 'https://example.org/apps/test-app',
      appName: 'Test App',
      capabilities: { actions: ['render'], features: [], types: ['*'] },
    };

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        pluginVersion: 'v2.0',
      }).success
    ).toBe(true);

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        pluginVersion: 'build-123',
      }).success
    ).toBe(true);

    expect(
      OQSEManifestSchema.safeParse({
        ...baseManifest,
        pluginVersion: 'beta',
      }).success
    ).toBe(true);
  });

  it('OQSEManifestSchema: enforces appName/description/author maximum lengths', () => {
    const valid = OQSEManifestSchema.safeParse({
      version: '1.0',
      id: 'https://example.org/apps/test-app',
      appName: 'A'.repeat(200),
      description: 'D'.repeat(5000),
      author: { name: 'Memizy Team', url: 'https://memizy.com' },
      capabilities: { actions: ['validate'], features: [] },
    });
    expect(valid.success).toBe(true);

    const invalid = OQSEManifestSchema.safeParse({
      version: '1.0',
      id: 'https://example.org/apps/test-app',
      appName: 'A'.repeat(201),
      description: 'D'.repeat(5001),
      author: { name: 'Memizy Team' },
      capabilities: { actions: ['validate'], features: [] },
    });

    expect(invalid.success).toBe(false);
  });

  it('OQSEManifestSchema: validates locales using BCP 47-style pattern', () => {
    expect(
      OQSEManifestSchema.safeParse({
        version: '1.0',
        id: 'https://example.org/apps/test-app',
        appName: 'Test App',
        locales: ['en-US', 'cs'],
        capabilities: { actions: ['validate'], features: [] },
      }).success
    ).toBe(true);

    const invalid = OQSEManifestSchema.safeParse({
      version: '1.0',
      id: 'https://example.org/apps/test-app',
      appName: 'Test App',
      locales: ['čeština'],
      capabilities: { actions: ['validate'], features: [] },
    });

    expect(invalid.success).toBe(false);
  });

  it('ManifestCapabilitiesSchema: requires x- prefix for custom types', () => {
    expect(
      ManifestCapabilitiesSchema.safeParse({
        actions: ['render'],
        types: ['flashcard', 'x-custom-card'],
      }).success
    ).toBe(true);

    const invalid = ManifestCapabilitiesSchema.safeParse({
      actions: ['render'],
      types: ['custom-card'],
    });

    expect(invalid.success).toBe(false);
  });

  it('ManifestCapabilitiesSchema: rejects mixed wildcard and explicit item types', () => {
    const ambiguous = ManifestCapabilitiesSchema.safeParse({
      actions: ['render'],
      types: ['flashcard', '*'],
    });
    expect(ambiguous.success).toBe(false);

    const wildcardOnly = ManifestCapabilitiesSchema.safeParse({
      actions: ['render'],
      types: ['*'],
    });
    expect(wildcardOnly.success).toBe(true);
  });

  it('ManifestCapabilitiesSchema: requires non-empty types for render action', () => {
    const missingTypes = ManifestCapabilitiesSchema.safeParse({
      actions: ['render'],
    });
    expect(missingTypes.success).toBe(false);

    const emptyTypes = ManifestCapabilitiesSchema.safeParse({
      actions: ['render'],
      types: [],
    });
    expect(emptyTypes.success).toBe(false);
  });

  it('ManifestCapabilitiesSchema: allows missing types for validate-only action', () => {
    const result = ManifestCapabilitiesSchema.safeParse({
      actions: ['validate'],
    });

    expect(result.success).toBe(true);
  });

  it('validateOQSEManifest: returns strongly typed manifest for valid payload', () => {
    const manifest = validateOQSEManifest({
      version: '1.0',
      id: 'https://example.org/apps/test-app',
      appName: 'Test App',
      capabilities: { actions: ['validate'], features: [] },
    });

    expect(manifest.appName).toBe('Test App');
  });

  it('safeValidateOQSEManifest + formatOQSEErrors: produces flat readable issues', () => {
    const result = safeValidateOQSEManifest({
      version: '1.0',
      appName: 'Missing ID App',
      capabilities: { actions: [] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatOQSEErrors(result.error);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('id'))).toBe(true);
    }
  });
});

