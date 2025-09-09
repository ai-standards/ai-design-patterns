// main.test.ts

import { UserPreferences, BrowsingBehavior, ContextProvider } from './main';

describe('UserPreferences', () => {
    let userPreferences: UserPreferences;

    beforeEach(() => {
        userPreferences = new UserPreferences();
    });

    test('should update preferences correctly', () => {
        userPreferences.updatePreferences('Books');
        expect(userPreferences.getPreferences()).toEqual(['Books']);
    });

    test('should allow multiple preferences to be added', () => {
        userPreferences.updatePreferences('Books');
        userPreferences.updatePreferences('Electronics');
        expect(userPreferences.getPreferences()).toEqual(['Books', 'Electronics']);
    });

    test('should not break when adding undefined preference', () => {
        userPreferences.updatePreferences(undefined as any); // Simulating an edge case
        expect(userPreferences.getPreferences()).toEqual([undefined]);
    });
});

describe('BrowsingBehavior', () => {
    let browsingBehavior: BrowsingBehavior;

    beforeEach(() => {
        browsingBehavior = new BrowsingBehavior();
    });

    test('should add page visits correctly', () => {
        browsingBehavior.addPageVisit('Homepage');
        expect(browsingBehavior.getVisitedPages()).toEqual(['Homepage']);
    });

    test('should allow multiple page visits to be added', () => {
        browsingBehavior.addPageVisit('Homepage');
        browsingBehavior.addPageVisit('Contact Page');
        expect(browsingBehavior.getVisitedPages()).toEqual(['Homepage', 'Contact Page']);
    });

    test('should not break when adding undefined page visit', () => {
        browsingBehavior.addPageVisit(undefined as any); // Simulating an edge case
        expect(browsingBehavior.getVisitedPages()).toEqual([undefined]);
    });
});

describe('ContextProvider', () => {
    test('should simulate user actions correctly', () => {
        const consoleLogSpy = jest.spyOn(console, 'log');
        ContextProvider.simulateUserActions();

        expect(consoleLogSpy).toHaveBeenCalledWith('Simulating user actions...');
        expect(consoleLogSpy).toHaveBeenCalledWith('New preference added: Electronics');
        expect(consoleLogSpy).toHaveBeenCalledWith('Updated visited pages: Smartphone Page, Laptop Page');

        consoleLogSpy.mockRestore();
    });
});
