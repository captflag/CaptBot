// Kept apart from parsers.ts so the UI can list accepted types without loading the parsers.
const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'mdx',
  'rst',
  'log',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'tex',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'kt',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'swift',
  'sql',
  'sh',
  'css',
];

export const TEXT_EXTENSION_SET = new Set(TEXT_EXTENSIONS);

export const ACCEPTED_FILE_TYPES = ['pdf', 'docx', 'html', 'htm', 'csv', 'tsv', 'json', ...TEXT_EXTENSIONS].map((e) => `.${e}`).join(',');
