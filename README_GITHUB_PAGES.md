# Publicação no GitHub Pages

Este projeto é Vite + React. O GitHub Pages não executa `src/main.tsx` diretamente.
Ele precisa publicar o resultado do build, que fica na pasta `dist/`.

## Opção recomendada: GitHub Actions

1. Envie este projeto inteiro para o repositório.
2. No GitHub, vá em **Settings > Pages**.
3. Em **Build and deployment**, escolha **GitHub Actions**.
4. Faça um commit/push na branch `main`.
5. O workflow `.github/workflows/deploy.yml` vai rodar `npm ci`, `npm run build` e publicar somente a pasta `dist/`.

## Opção manual

Rode:

```bash
npm install
npm run build
```

Depois publique somente o conteúdo da pasta `dist/`.

Não publique o `index.html` da raiz diretamente, porque ele aponta para `/src/main.tsx`, que só funciona no servidor de desenvolvimento do Vite.
