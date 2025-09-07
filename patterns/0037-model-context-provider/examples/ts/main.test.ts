import { createRecommendation } from './main';

// Mocking the context classes to control their outputs
jest.mock('./main', () => ({
    UserProfile: jest.fn().mockImplementation(() => ({
        getUserPreferences: jest.fn().mockReturnValue(["electronics", "books", "clothing"]),
    })),
    Product: jest.fn().mockImplementation(() => ({
        getProductDetails: jest.fn().mockReturnValue({ name: "Smartphone", price: 699 }),
    })),
    Factors: jest.fn().mockImplementation(() => ({
        getTimeOfDay: jest.fn().mockReturnValue("morning"),
    })),
}));

describe('Recommendation System', () => {
    // Test for creating a recommendation
    it('should generate a personalized recommendation based on user preferences and product details', () => {
        const userId = "user123";
        const productId = "product456";

        const recommendation = createRecommendation(userId, productId);

        expect(recommendation).toBe(
            "Good morning, based on your interest in electronics, books, clothing, we recommend the Smartphone for $699."
        );
    });

    // Test for different times of the day
    it('should generate a recommendation for afternoon', () => {
        // Mocking the Factors class to return "afternoon"
        const Factors = require('./main').Factors;
        Factors.mockImplementation(() => ({
            getTimeOfDay: jest.fn().mockReturnValue("afternoon"),
        }));

        const userId = "user123";
        const productId = "product456";

        const recommendation = createRecommendation(userId, productId);

        expect(recommendation).toBe(
            "Good afternoon, based on your interest in electronics, books, clothing, we recommend the Smartphone for $699."
        );
    });

    // Test for edge case: empty user preferences
    it('should handle empty user preferences gracefully', () => {
        // Mocking UserProfile to return empty preferences
        const UserProfile = require('./main').UserProfile;
        UserProfile.mockImplementation(() => ({
            getUserPreferences: jest.fn().mockReturnValue([]),
        }));

        const userId = "user123";
        const productId = "product456";

        const recommendation = createRecommendation(userId, productId);

        expect(recommendation).toBe(
            "Good morning, based on your interest in , we recommend the Smartphone for $699."
        );
    });
});
