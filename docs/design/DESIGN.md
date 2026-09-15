# DESIGN.md — Tormenta VTT

## Mundo visual
Grimório à luz do lampião: base carvão quente, pergaminho no texto, um dourado contido como
único destaque de marca. O mapa é o herói; a interface recua. Modo: Operate — densidade alta,
consistência e legibilidade por horas acima de expressão. Nada de ornamento em tudo, texturas de
couro, tipografia gótica, brilhos ou gradientes.

## Cor (tokens)
--bg            #121212  fundo da aplicação
--surface-1     #1D1D1D  painéis
--surface-2     #2C2C2C  cartões, superfícies elevadas
--border        #3A3A38  filetes; 0,5–1px, nunca caixas grossas
--text          #DCD8CC  texto primário (pergaminho, não branco)
--text-muted    #A6A29C  rótulos e apoio
--accent        #C79C54  dourado: turno atual, ação principal, marca — um por vista
--danger        #BF4040  erro, alerta destrutivo
--success       #709970  confirmação
Tipos de dano (só em chips): fogo #D85A30 · frio #378ADD · eletricidade #EFA927 ·
ácido #639922 · luz #F2D08A · trevas #7F77DD · físicos #888780

Regras: um só dourado por tela; cor de dano nunca vira cor de interface; nada de gradiente.

## Tipografia
Títulos: Cinzel — nome do app, títulos de painel, nome de mapa. Só em texto curto, caixa alta com
espaçamento leve. Nunca em números, chat, formulário ou rótulo pequeno.
Interface: IBM Plex Sans — todo o resto. Números tabulares ligados (font-variant-numeric:
tabular-nums) em ficha, iniciativa e PV.
Fórmulas e dados: IBM Plex Mono — "2d6+3", resultados, códigos de sala.
Escala: 12 / 13 / 14 / 16 / 20 / 28. Corpo 13–14 nos painéis.

## Espaço e forma
Grade de 4px. Raio 6px (8px em diálogos). Sombra só em camadas flutuantes (diálogo, dropdown,
overlay); nunca em cartão dentro de painel.
Cartão só quando o conteúdo é uma unidade selecionável ou clicável. Nunca cartão dentro de
cartão — use filete e espaço para separar.

## Densidade por área
Mapa: silêncio. Barras translúcidas, nada fixo que roube atenção.
Painéis (chat, iniciativa, fichas): densidade alta, ritmo regular, tudo escaneável.
Diálogos: respiro maior, uma ação principal em dourado, as demais neutras.

## Movimento
Só funcional: 120–180ms, ease-out. Transição de estado, aparecer/sumir, hover das barras.
Nada de bounce, elástico, parallax ou animação de entrada decorativa.

## Anti-padrões (banidos)
Inter e fontes de sistema; gradiente roxo-azul; cinza azulado de SaaS; brilho/glow; ícone em
quadrado arredondado acima de título; cartão dentro de cartão; texto cinza sobre fundo colorido;
bounce; emoji como ícone de interface.
