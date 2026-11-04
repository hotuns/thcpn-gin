import config from '../playwright.config';
export default { ...config, projects: config.projects?.filter(project => project.name === 'desktop'), testDir: '.', testMatch: ['**/atlas.spec.ts'], timeout: 60000, outputDir: './artifacts/atlas/results', reporter: [['list']] };
