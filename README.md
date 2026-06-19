# SETE
<a href="#">
<img src="https://files.cercomp.ufg.br/weby/up/767/o/setepretoPrancheta_1_4x.png" alt="SETE Logo" width="400">
</a>


[![Build status](https://ci.appveyor.com/api/projects/status/3b989hf236b2i47d?svg=true)](https://ci.appveyor.com/project/marcosroriz/sete)


O Sistema Eletrônico de Gestão do Transporte Escolar (SETE) é um software de _e-governança_ desenvolvido pelo [CECATE UFG](https://transportes.fct.ufg.br/p/31447-apresentacao-do-cecate-ufg) voltado a auxiliar na gestão do transporte escolar dos municípios brasileiros considerados suas singularidades.  O sistema foi projeto com intuito de não depender de nenhum software proprietário, desta forma é possível utilizá-lo sem ter de licenciar programas dependentes.

O SETE possui versões para web, desktop e móvel (em andamento). A versão desktop possibilita que o mesmo seja utilizado para operar em municípios que possuem acesso restrito à Internet sendo resiliente o suficiente para continuar operando mesmo na ausência de acesso à Internet. A versão web e a versão desktop são aproximadamente idênticas. A diferença é que a versão web não inclui as ferramentas de sugestões de rotas.

## Baixando o Sete
Para baixar o _software_, basta clicar na versão abaixo do seu sistema operacional.

<a href="https://github.com/marcosroriz/sete/releases/download/v2.1.0/sete-2.1.0.msi">  <img src="https://files.cercomp.ufg.br/weby/up/767/o/baixarwindows.png" alt="baixar sete para windows" width="200" height="81" /></a>&nbsp; &nbsp; &nbsp;&nbsp;<a href="https://github.com/marcosroriz/sete/releases/download/v2.1.0/sete-2.1.0.dmg"><img src="https://files.cercomp.ufg.br/weby/up/767/o/baixarmac.png" alt="baixar sete para mac" width="200" height="81" /></a>&nbsp; &nbsp; &nbsp;&nbsp;<a href="https://github.com/marcosroriz/sete/releases/download/v2.1.0/sete_2.1.0_amd64.deb"><img src="https://files.cercomp.ufg.br/weby/up/767/o/baixarlinux.png" alt="baixar sete para linux" width="200" height="81" /></a></p>


## Construindo (*building*) o SETE

O SETE é construído em cima do *framework*  [Electron](https://github.com/electron/electron), um arcabouço para codificação de aplicações desktop modernas baseado no ecosistema Node.js. 

O SETE utiliza bibliotecas nativas, a saber o SQLite, para possibilitar o uso e armazenamento de informações de forma *offline*. 

O projeto utiliza uma pilha legada. Para evitar incompatibilidades com as dependências nativas, especialmente `sqlite3` e `spatialite`, recomenda-se usar as versões abaixo ao executar o projeto localmente:

* Node.js v12.18.3
* npm 6.x (instalado junto com o Node.js v12)
* Yarn v1.22.x
* Electron v8.5.2
* Python 2.7 para recompilar módulos nativos antigos
* `build-essential`, `make` e `g++` no GNU/Linux
* `fakeroot`, `dpkg` e `rpm` apenas para gerar pacotes GNU/Linux
* [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) para compilação dos módulos no Windows
* [Wix Toolset](https://wixtoolset.org) para gerar binários `.msi` e `.exe` no Windows

### 1: Instalação das dependências básicas com NVM

Instale o [Node Version Manager - NVM](https://github.com/nvm-sh/nvm) e use a versão definida em `.nvmrc`:

```sh
nvm install
nvm use
node -v
npm -v
```

O `node -v` deve retornar `v12.18.3`. Instale também o Yarn 1.x:

```sh
npm install --global yarn@1.22.22
yarn -v
```

No GNU/Linux, instale as ferramentas de compilação:

```sh
sudo apt-get install build-essential make g++
```

Caso queira gerar pacotes GNU/Linux, instale também:

```sh
sudo apt-get install fakeroot dpkg rpm
```

#### Ubuntu 24.04 e WSL

O Ubuntu 24.04 não fornece `python2` nos repositórios padrão. Como o `sqlite3@5.0.0` ainda usa uma versão antiga do `node-gyp`, configure um Python 2.7 disponível na máquina antes de recompilar a dependência nativa. Uma opção é instalar o Python 2.7.18 via `pyenv` ou usar outro pacote compatível:

```sh
sudo apt-get install build-essential curl git libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev tk-dev xz-utils
```

Sem as bibliotecas de desenvolvimento acima, o `pyenv` pode falhar com mensagens como `The Python zlib extension was not compiled` ou `The Python readline extension was not compiled`.

```sh
npm config set python /caminho/para/python2
```

Confira a configuração:

```sh
npm config get python
```

Em WSL, o Electron também precisa de suporte gráfico. No Windows 11 com WSLg isso normalmente já funciona. Em outros ambientes, erros como `Missing X server` ou `cannot open display` indicam problema de display/GUI, não necessariamente problema nas dependências do SETE.

#### Windows

No Windows, instale o Wix Toolset e coloque o diretório `bin` na variável `PATH`. Por exemplo:

```txt
C:\Program Files (x86)\WiX Toolset v3.11\bin
```

Também é necessário instalar o pacote global [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) como administrador:

```sh
npm install --global windows-build-tools
```

Depois, configure o compilador do Visual Studio e o Python 2.7:

```sh
npm config set msvs_version "2017"
npm config set python "C:\\Python27-x64\\pythonw.exe"
```

### 2: Baixe o código fonte

```sh
git clone https://github.com/marcosroriz/sete/
cd sete
nvm use
```

### 3: Instalação das dependências

Instale as dependências do projeto:

```sh
npm install
```

Por fim, recompile o `sqlite3` para o Electron 8.5.2:

```sh
npm rebuild sqlite3 --build-from-source --runtime=electron --target=8.5.2 --dist-url=https://electronjs.org/headers
```

### 4: Executando o projeto

Para executar o projeto basta utilizar o seguinte comando:

```sh
npm run start
```

No WSL, caso o Electron 8 falhe com erro de compositor gráfico/GPU, use o script específico para esse ambiente:

```sh
npm run start:wsl
```

### 5: Geração de Binários

A geração de binários é feita utilizando o utilitário `electron-forge`. Especificamente, para gerar os binários, que ficarão na pasta `out`, execute o seguinte comando:

```sh
npm run make
```

### Solução de problemas

#### Erros envolvendo `sqlite3`, `node-gyp` ou Python

Verifique se o Node.js ativo é o Node 12.18.3:

```sh
node -v
```

Confirme também se o npm está apontando para um Python 2.7 válido:

```sh
npm config get python
```

Depois rode novamente:

```sh
npm rebuild sqlite3 --build-from-source --runtime=electron --target=8.5.2 --dist-url=https://electronjs.org/headers
```

Caso apareça `ValueError: invalid mode: 'rU'`, o `node-gyp` antigo está usando Python 3.11 ou superior. Configure o npm para usar Python 2.7 com suporte a `zlib`/`gzip`, ou use uma versão de Python 3 anterior a 3.11 para essa etapa de rebuild.

#### `npm install` altera o `package-lock.json`

Este repositório possui um `package-lock.json` antigo. Ao preparar mudanças para um Pull Request, confira o diff antes de commitar e evite incluir alterações no lockfile se elas não forem necessárias para a correção.

#### O Electron não abre no WSL

Se a instalação terminar sem erros, mas `npm run start` falhar com mensagens de display, valide se o WSL possui suporte gráfico. No Windows 11, use WSLg atualizado. Em ambientes sem WSLg, configure um servidor X ou rode o projeto em um ambiente Linux com sessão gráfica.

Em ambientes WSL com Electron 8, também pode ocorrer a falha `The display compositor is frequently crashing`. Nesse caso, rode:

```sh
npm run start:wsl
```

## Licença de Uso
O sistema é distribuído gratuitamente sob a licença de software livre [MIT](https://github.com/marcosroriz/sete/blob/master/LICENSE) que possibilita o compartilhamento e modificação do código do mesmo por terceiros, por exemplo, por agências públicas, empresas e equipes tecnológicas dos municípios.
