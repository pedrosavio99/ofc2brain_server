# Etapa 1: treino.html carrega o CSS novo, o componente do mapa e o script das fotos.
HTML_ARQ = "modulos/treino/publico/treino.html"

trocar(HTML_ARQ,
       '<link rel="stylesheet" href="/treino/treino.css" />\n',
       '<link rel="stylesheet" href="/treino/treino.css" />\n'
       '<link rel="stylesheet" href="/treino/treino-visual.css" />\n')

trocar(HTML_ARQ,
       '<script src="/treino/treino.js"></script>\n',
       '<script type="module" src="/treino/componentes/mapa-corpo.js"></script>\n'
       '<script src="/treino/exercicio-foto.js"></script>\n'
       '<script src="/treino/treino.js"></script>\n')
