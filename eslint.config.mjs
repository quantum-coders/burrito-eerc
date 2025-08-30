// eslint.config.js
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
});

const eslintConfig = [
	...compat.extends('next/core-web-vitals', 'next/typescript'),
	{
		ignores: [
			'node_modules/**',
			'.next/**',
			'out/**',
			'build/**',
			'next-env.d.ts',   // <- ignora ese archivo generado por Next
		],
		rules: {
			// Opciones para la regla que te da error
			// 1) Desactívala del todo:
			// "@typescript-eslint/no-explicit-any": "off",

			// 2) O baja a warning en vez de error:
			'@typescript-eslint/no-explicit-any': 'warn',
		},
	},
];

export default eslintConfig;
