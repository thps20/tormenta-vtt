-- Token.cells (docs/plano-grid.md): lado do token em células vira a fonte da verdade do tamanho;
-- width/height (pixels fixos) deixam de existir — os pixels passam a ser sempre derivados
-- (tokenPixelSize, packages/shared) de cells × cellSize do grid ATUAL do token.
--
-- Ordem: adiciona "cells" (default 1) -> backfill a partir de width/height -> só então apaga as
-- colunas antigas. Rodar as três etapas juntas (não em migrations separadas) evita uma janela em
-- que "cells" existe mas ainda não reflete o tamanho real dos tokens já gravados.

ALTER TABLE "Token" ADD COLUMN "cells" INTEGER NOT NULL DEFAULT 1;

-- Registra tokens não quadrados (width <> height) antes de arredondar pela largura — não deveria
-- acontecer hoje (todo token nasce quadrado), mas o schema antigo permitia width != height.
DO $$
DECLARE affected INTEGER;
BEGIN
  SELECT count(*) INTO affected FROM "Token" WHERE "width" <> "height";
  IF affected > 0 THEN
    RAISE NOTICE 'Token.cells: % token(s) não quadrado(s) arredondado(s) pela largura', affected;
  END IF;
END $$;

-- cells = round(width / cellSize da cena), mínimo 1. Grid "none" (ou cellSize ausente/zerado) usa
-- a célula virtual de 70px — mesma convenção de effectiveCellSize() no web e no servidor.
UPDATE "Token" t
SET "cells" = GREATEST(1, ROUND(CAST(t."width" / c.cell AS numeric))::int)
FROM (
  SELECT s.id,
         CASE WHEN COALESCE(s."grid"->>'type', 'square') = 'square'
              THEN COALESCE(NULLIF(CAST(s."grid"->>'cellSize' AS numeric), 0), 70)
              ELSE 70 END AS cell
  FROM "Scene" s
) c
WHERE t."sceneId" = c.id;

ALTER TABLE "Token" DROP COLUMN "height";
ALTER TABLE "Token" DROP COLUMN "width";
