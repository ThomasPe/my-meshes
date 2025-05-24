import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        appName: "My Meshes",
        titleHomePage: "Home Page",
        titleSettingsPage: "Settings",
        titleExplorerPage: "Explorer",
        explorer: {
          selectItem: "Select an item to view details",
          fileSelected: "File details shown in right panel",
          noFileSelected: "No file selected",
          folderInfo: "Folder Information",
          fileInfo: "File Information",
          preview: "Preview",
          previewPlaceholder: "3D model preview would appear here",
          contains: "Contains",
          files: "files",
          folders: "folders",
          file: "file",
          folder: "folder",
          and: "and",
          type: "Type",
          size: "Size",
          modified: "Modified",
          contents: "Contents",
          selectRootFolder: "Select Root Folder",
          changeRootFolder: "Change Root Folder",
          noRootFolder: "No root folder selected"
        },
        settings: {
          appearance: "Appearance",
          appearanceDescription: "Configure the application's theme and visual settings.",
          fileSystem: "File System",
          fileSystemDescription: "Configure file system access and default directories.",
          themeMode: "Theme Mode",
          darkMode: "Dark",
          lightMode: "Light",
          systemMode: "System"
        }
      },
    },
    "pt-BR": {
      translation: {
        appName: "My Meshes",
        titleHomePage: "Página Inicial",
        titleSettingsPage: "Configurações",
        titleExplorerPage: "Explorador",
        explorer: {
          selectItem: "Selecione um item para ver detalhes",
          fileSelected: "Detalhes do arquivo no painel direito",
          noFileSelected: "Nenhum arquivo selecionado",
          folderInfo: "Informações da Pasta",
          fileInfo: "Informações do Arquivo",
          preview: "Prévia",
          previewPlaceholder: "Prévia do modelo 3D apareceria aqui",
          contains: "Contém",
          files: "arquivos",
          folders: "pastas",
          file: "arquivo",
          folder: "pasta",
          and: "e",
          type: "Tipo",
          size: "Tamanho",
          modified: "Modificado",
          contents: "Conteúdo",
          selectRootFolder: "Selecionar Pasta Raiz",
          changeRootFolder: "Mudar Pasta Raiz",
          noRootFolder: "Nenhuma pasta raiz selecionada"
        },
        settings: {
          appearance: "Aparência",
          appearanceDescription: "Configure o tema e as configurações visuais do aplicativo.",
          fileSystem: "Sistema de Arquivos",
          fileSystemDescription: "Configure o acesso ao sistema de arquivos e diretórios padrão.",
          themeMode: "Modo de Tema",
          darkMode: "Escuro",
          lightMode: "Claro",
          systemMode: "Sistema"
        }
      },
    },
  },
});
