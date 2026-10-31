#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
treino-visual-aplicar  (projeto: Vercel, modulo Treino, so o front)

Recebe: o projeto 2brain-v2-supabase-vercel, com este script rodado na RAIZ dele.
Faz: troca os dois bonecos do Treino pelo <mapa-corpo> do vault e poe uma miniatura de
     foto de exemplo ao lado de cada exercicio, com um modal pequeno ao tocar nela.
Nao faz: mexer no servidor, no banco, na geracao da ficha ou no toque que marca "feito".

Regras: atomico (monta tudo na memoria e so grava se NADA falhou), junta todas as falhas,
ancoras exatas, detecta o estado (tudo aplicado, nada aplicado ou pela metade), idempotente.
"""
import datetime
import os
import shutil
import subprocess
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.getcwd()
PASTA_TREINO = "modulos/treino/publico"
NOVOS = os.path.join(AQUI, "novos")
PARTES = os.path.join(AQUI, "partes")

FALHAS = []   # sem repetidas
AVISOS = []
STAGE = {}    # caminho relativo (com /) -> texto novo dos arquivos que levam patch

# marcadores: uma string que so existe depois da etapa
MARCAS = [
    ("html", PASTA_TREINO + "/treino.html", "treino-visual.css"),
    ("js", PASTA_TREINO + "/treino.js", "function mapaVivo("),
]


def falha(msg):
    if msg not in FALHAS:
        FALHAS.append(msg)


def caminho(rel):
    return os.path.join(RAIZ, *rel.split("/"))


def resumo(txt, n=90):
    t = " ".join(txt.split())
    return t if len(t) <= n else t[: n - 3] + "..."


def ler(rel):
    """Texto UTF-8 do arquivo (ou a versao ja em memoria). Mantem o fim de linha como esta."""
    if rel in STAGE:
        return STAGE[rel]
    p = caminho(rel)
    if not os.path.isfile(p):
        falha("arquivo nao encontrado: " + rel)
        return None
    try:
        with open(p, "r", encoding="utf-8", newline="") as f:
            return f.read()
    except Exception as e:
        falha("nao consegui ler %s (%s: %s)" % (rel, type(e).__name__, e))
        return None


def trocar(rel, velho, novo, vezes=1):
    """Troca um trecho exato. Tem de existir exatamente vezes vezes (padrao 1), senao vira falha."""
    t = ler(rel)
    if t is None:
        return
    n = t.count(velho)
    if n != vezes:
        falha("%s: trecho achado %d vez(es), esperado %d: %s" % (rel, n, vezes, resumo(velho)))
        return
    STAGE[rel] = t.replace(velho, novo)


def lista_novos():
    saida = []
    for base, _dirs, arqs in os.walk(NOVOS):
        for a in arqs:
            cheio = os.path.join(base, a)
            saida.append(os.path.relpath(cheio, NOVOS).replace(os.sep, "/"))
    return sorted(saida)


def bytes_de(p):
    with open(p, "rb") as f:
        return f.read()


def checar_sintaxe_js(rotulo, texto):
    """node --check num arquivo temporario .cjs (a tela e um script comum, nao modulo)."""
    if shutil.which("node") is None:
        AVISOS.append("node nao encontrado: nao conferi a sintaxe de " + rotulo)
        return
    with tempfile.TemporaryDirectory() as tmp:
        arq = os.path.join(tmp, "conferir.cjs")
        with open(arq, "w", encoding="utf-8", newline="") as f:
            f.write(texto)
        r = subprocess.run(["node", "--check", arq], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            erro = (r.stderr or r.stdout).decode("utf-8", "replace").strip().splitlines()
            falha("erro de sintaxe em %s depois do patch: %s" % (rotulo, " | ".join(erro[:3])))


def sair_com_falhas():
    print("")
    print("NADA FOI ALTERADO. %d problema(s) encontrado(s):" % len(FALHAS))
    for i, f in enumerate(FALHAS, 1):
        print("  %d. %s" % (i, f))
    print("")
    print("Me mande esta lista INTEIRA (copie tudo acima) que eu resolvo tudo de uma vez.")
    sys.exit(1)


def main():
    print("treino-visual-aplicar: mapa do corpo do vault + foto de exemplo nos exercicios")

    # --- pasta certa?
    if not os.path.isdir(caminho("public")) or not os.path.isdir(caminho(PASTA_TREINO)):
        print("")
        print("Esta pasta nao parece a raiz do projeto Vercel (faltou public/ ou %s)." % PASTA_TREINO)
        print("Pasta atual: " + RAIZ)
        print("Entre na raiz do projeto 2brain-v2-supabase-vercel e rode o comando de novo.")
        sys.exit(1)
    if not os.path.isdir(NOVOS) or not os.path.isdir(PARTES):
        print("")
        print("Nao achei novos/ e partes/ ao lado do aplicar.py. O zip foi aberto por inteiro? Rode o unzip de novo.")
        sys.exit(1)

    # --- estado dos arquivos que levam patch
    aplicado = {}
    for nome, rel, marca in MARCAS:
        t = ler(rel)
        if t is not None:
            aplicado[nome] = marca in t
    if FALHAS:
        sair_com_falhas()

    feitos = [n for n, v in aplicado.items() if v]
    if feitos and len(feitos) != len(aplicado):
        print("")
        print("O projeto esta pela metade: parte do pacote ja foi aplicada e parte nao.")
        for nome, rel, marca in MARCAS:
            print("  - %s: %s" % (rel, "ja aplicado" if aplicado[nome] else "falta aplicar"))
        print("Nao alterei nada. Me mande estas linhas (e o que voce fez antes) que eu monto o ajuste certo.")
        sys.exit(1)
    patches_prontos = bool(feitos)

    # --- arquivos novos: ausente, igual ou diferente
    novos = lista_novos()
    escrever = []   # (rel, existia)
    for rel in novos:
        destino = caminho(rel)
        if not os.path.isfile(destino):
            escrever.append((rel, False))
        elif bytes_de(destino) != bytes_de(os.path.join(NOVOS, *rel.split("/"))):
            escrever.append((rel, True))

    if patches_prontos and not escrever:
        print("")
        print("Ja estava tudo aplicado. Nada foi alterado.")
        sys.exit(0)

    # --- patches (so se ainda nao aplicados)
    if not patches_prontos:
        ctx = {"trocar": trocar, "ler": ler, "falha": falha, "STAGE": STAGE}
        for nome in sorted(os.listdir(PARTES)):
            if not nome.endswith(".py"):
                continue
            try:
                with open(os.path.join(PARTES, nome), "r", encoding="utf-8") as f:
                    codigo = compile(f.read(), nome, "exec")
                exec(codigo, ctx)
            except Exception as e:
                falha("parte %s: %s: %s" % (nome, type(e).__name__, e))

    # --- confere o que foi montado (ainda em memoria)
    if not FALHAS:
        for rel, texto in STAGE.items():
            if rel.endswith(".js"):
                checar_sintaxe_js(rel, texto)
        for rel, _existia in escrever:
            if rel.endswith("exercicio-foto.js"):
                with open(os.path.join(NOVOS, *rel.split("/")), "r", encoding="utf-8", newline="") as f:
                    checar_sintaxe_js(rel, f.read())

    if FALHAS:
        sair_com_falhas()

    # --- grava (so aqui). Backup primeiro; se algo falhar no meio, desfaz tudo.
    carimbo = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    pasta_bkp_rel = PASTA_TREINO + "/.backup-treino-visual-" + carimbo
    gravados = []   # (rel, copia_do_original ou None)
    try:
        def guardar(rel):
            origem = caminho(rel)
            if not os.path.isfile(origem):
                return None
            sub = rel[len(PASTA_TREINO) + 1:] if rel.startswith(PASTA_TREINO + "/") else rel.replace("/", "__")
            copia = os.path.join(caminho(pasta_bkp_rel), *sub.split("/"))
            os.makedirs(os.path.dirname(copia), exist_ok=True)
            shutil.copy2(origem, copia)
            return copia

        for rel, texto in STAGE.items():
            copia = guardar(rel)
            destino = caminho(rel)
            tmp = destino + ".tmp-treino-visual"
            with open(tmp, "w", encoding="utf-8", newline="") as f:
                f.write(texto)
            os.replace(tmp, destino)
            gravados.append((rel, copia))

        for rel, _existia in escrever:
            copia = guardar(rel)
            destino = caminho(rel)
            os.makedirs(os.path.dirname(destino), exist_ok=True)
            tmp = destino + ".tmp-treino-visual"
            shutil.copyfile(os.path.join(NOVOS, *rel.split("/")), tmp)
            os.replace(tmp, destino)
            gravados.append((rel, copia))
    except Exception as e:
        print("")
        print("Falhou ao gravar (%s: %s). Desfazendo o que ja foi escrito..." % (type(e).__name__, e))
        for rel, copia in reversed(gravados):
            try:
                if copia:
                    shutil.copyfile(copia, caminho(rel))
                else:
                    os.remove(caminho(rel))
            except Exception:
                pass
        print("Desfeito. Me mande esta mensagem.")
        sys.exit(1)

    # --- resultado
    print("")
    print("PRONTO.")
    if STAGE:
        print("Arquivos alterados:")
        for rel in STAGE:
            print("  - " + rel)
    print("Arquivos novos (%d):" % len(escrever))
    for rel, existia in escrever:
        print("  - %s%s" % (rel, " (atualizado)" if existia else ""))
    if os.path.isdir(caminho(pasta_bkp_rel)):
        print("Backup dos originais: " + pasta_bkp_rel + "/")
    for a in AVISOS:
        print("Aviso: " + a)
    print("")
    print("Proximo passo: suba como voce sempre sobe (git push ou vercel --prod) e abra /treino.")
    print("A pasta treino-visual-aplicar/ pode ser apagada depois.")


if __name__ == "__main__":
    main()
