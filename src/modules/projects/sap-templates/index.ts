import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SAP Report Templates — loaded once at startup.
 *
 * These .md files live next to this file in the source tree AND in the
 * compiled output (nest-cli.json copies them via the assets rule).
 * We resolve relative to __dirname so it works in both `ts-node` (dev)
 * and compiled `dist/` (prod).
 */

function loadTemplate(filename: string): string {
  // In dev (ts-node) __dirname points to src/modules/projects/sap-templates
  // In prod (compiled) __dirname points to dist/modules/projects/sap-templates
  // Either way the .md files are siblings.
  const srcPath = join(__dirname, filename);
  try {
    return readFileSync(srcPath, 'utf-8');
  } catch {
    // Fallback: try relative to the source directory (for ts-node without assets)
    const fallback = join(
      __dirname,
      '..', '..', '..', '..', // back to project root from dist/modules/projects/sap-templates
      'src', 'modules', 'projects', 'sap-templates',
      filename,
    );
    return readFileSync(fallback, 'utf-8');
  }
}

// Demo reports — the AI uses these as the exact output format to follow
export const DEMO_STUDENT_REPORT = loadTemplate('DEMO_Student.md');
export const DEMO_TEACHER_REPORT = loadTemplate('DEMO_Teacher.md');
export const DEMO_ADMIN_REPORT = loadTemplate('DEMO_Admin.md');
