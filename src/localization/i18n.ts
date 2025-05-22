import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        appName: "electron-shadcn",
        titleHomePage: "Home Page",
        titleSecondPage: "Second Page",
        titleExplorerPage: "Explorer",
        explorer: {
          selectItem: "Select an item to view details",
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
        }
      },
    },
    "pt-BR": {
      translation: {
        appName: "electron-shadcn",
        titleHomePage: "Página Inicial",
        titleSecondPage: "Segunda Página",
        titleExplorerPage: "Explorador",
        explorer: {
          selectItem: "Selecione um item para ver detalhes",
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
        }
      },
    },
  },
});
