import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import hi from './hi';

export type AppLanguage = 'EN' | 'HI';

export const deviceLanguage = (): AppLanguage => (getLocales()[0]?.languageCode === 'hi' ? 'HI' : 'EN');

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: deviceLanguage() === 'HI' ? 'hi' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setAppLanguage(lang: AppLanguage) {
  void i18n.changeLanguage(lang === 'HI' ? 'hi' : 'en');
}

export const currentLanguage = (): AppLanguage => (i18n.language === 'hi' ? 'HI' : 'EN');

export default i18n;
