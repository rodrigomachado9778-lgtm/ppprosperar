This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Perfis (admin / vendedor)

- Defina quem é admin via `.env.local`:

```
NEXT_PUBLIC_ADMIN_EMAILS=admin@seu-dominio.com;outro@seu-dominio.com
```

- Qualquer usuário logado cujo e-mail **não** estiver na lista acima entra como `vendor`.
- O vendedor usa `/vendedor/validar` para validar cartelas vendidas.



## Variáveis de ambiente

Crie `.env.local`:

- `NEXT_PUBLIC_ADMIN_EMAILS` (separado por `;`)
- `NEXT_PUBLIC_CPF_HASH_SALT` (qualquer texto para sal do hash do CPF)

Exemplo:

```
NEXT_PUBLIC_ADMIN_EMAILS=admin@exemplo.com;outro@exemplo.com
NEXT_PUBLIC_CPF_HASH_SALT=prosperar-v1
```

## Firestore Rules

Veja `FIRESTORE_RULES.txt`.


## Configuração de ambiente

Copie `.env.example` para `.env.local` e ajuste as variáveis conforme seu projeto Firebase.

> Observação: as chaves `NEXT_PUBLIC_*` do Firebase não são segredos, mas ainda assim recomenda-se não comitar `.env.local`.

## Consulta pública (/resultado) sem expor cartelas no Firestore

A rota **/resultado** continua pública (sem login), mas a leitura das cartelas no Firestore foi **restrita**.
A consulta agora é feita via endpoint server-side:

- `GET /api/public/card?editionId=...&publicNumberInt=...`

Isso exige **Firebase Admin** configurado no servidor. Defina no `.env.local` (e no provedor de deploy):

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`  (guarde o valor com `\n` no lugar das quebras de linha)

> Dica: em Vercel, cole a chave privada como uma única linha e mantenha os `\n`.

## Criação de edições (travada)

Para evitar duas edições em paralelo, o sistema usa um documento singleton:

- `config/system` com os campos `currentEditionId` e `currentEditionStatus`.

Uma nova edição só pode ser criada quando `currentEditionStatus == FINISHED`.
Quando o sorteio termina (última rodada fecha), o status é atualizado para `FINISHED` e a criação de nova edição é liberada.



## Segurança: apenas ADMIN cadastra vendedores

Este projeto foi ajustado para que **somente o ADMIN** possa cadastrar/alterar/excluir vendedores.

### 1) Definir o primeiro ADMIN (bootstrap)

1. Crie/identifique o UID do usuário que será admin (via Firebase Auth).
2. Configure as env vars do Firebase Admin SDK (veja `.env.example`).
3. Rode:

```bash
node scripts/bootstrap-admin.mjs <UID> <EMAIL>

```

### Backfill de vendas antigas (vendorUid)

Se você já tinha vendas criadas antes das regras mais restritas, elas podem estar sem o campo `vendorUid`.
Nesse caso, o vendedor pode receber `permission-denied` ao tentar carregar **Minhas vendas recentes**.

Para corrigir, rode o script abaixo com credenciais de Admin SDK (Service Account):

1) Defina as credenciais:

- Opção A (recomendada):
  - Baixe um JSON de Service Account e exporte:
    - `GOOGLE_APPLICATION_CREDENTIALS=/caminho/para/serviceAccount.json`

- Opção B:
  - Exportar `FIREBASE_SERVICE_ACCOUNT_JSON` como o JSON completo em uma variável.

2) Rode em modo **dry-run** (não grava nada):

```bash
node scripts/backfill-sales-vendorUid.mjs --dry-run
```

3) Se os logs estiverem ok, execute de fato:

```bash
node scripts/backfill-sales-vendorUid.mjs --commit
```

Opcional: limitar a uma edição:

```bash
node scripts/backfill-sales-vendorUid.mjs --edition=<EDITION_ID> --commit
```

Depois disso, faça logout/login para o token atualizar (custom claims).

### 2) Cadastrar vendedores

No painel **/admin/vendedores**, use o formulário “Cadastrar vendedor”.
O sistema cria o usuário no Firebase Auth, define `role=vendor` via custom claims e cria o perfil em `users/{uid}`.

### Observação

As regras do Firestore (`FIRESTORE_RULES.txt`) passaram a confiar em **custom claims** (`request.auth.token.role`) e **bloqueiam** criação/alteração de `users/{uid}` por não-admin.
