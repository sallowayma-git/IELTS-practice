/**
 * 用户体验验证器
 * 负责验证系统的用户友好性和易用性
 */
class UserExperienceValidator {
    constructor() {
        this.validationResults = {};
        this.userFriendlyMessages = [];
        this.accessibilityIssues = [];
        
        console.log('[UserExperienceValidator] 用户体验验证器已初始化');
    }

    /**
     * 运行完整的用户体验验证
     */
    async runFullUXValidation() {
        console.log('[UserExperienceValidator] 开始用户体验验证...');
        
        try {
            const results = {
                interfaceSimplicity: await this.validateInterfaceSimplicity(),
                userFriendlyErrors: await this.validateUserFriendlyErrors(),
                mobileResponsiveness: await this.validateMobileResponsiveness(),
                accessibility: await this.validateAccessibility(),
                easeOfUse: await this.validateEaseOfUse()
            };

            return this.generateUXReport(results);
            
        } catch (error) {
            console.error('[UserExperienceValidator] 验证失败:', error);
            throw error;
        }
    }

    /**
     * 验证界面简洁性
     */
    async validateInterfaceSimplicity() {
        const checks = [];
        
        // 检查主导航是否简洁
        const navButtons = document.querySelectorAll('.nav-btn');
        checks.push({
            name: '主导航按钮数量',
            passed: navButtons.length <= 5,
            details: `导航按钮数量: ${navButtons.length}`
        });

        // 检查是否有清晰的页面标题
        const pageTitle = document.querySelector('.header h1');
        checks.push({
            name: '页面标题可见性',
            passed: pageTitle && pageTitle.textContent.trim().length > 0,
            details: pageTitle ? pageTitle.textContent : '无标题'
        });

        return {
            category: '界面简洁性',
            passed: checks.filter(c => c.passed).length,
            total: checks.length,
            checks: checks
        };
    }

    /**
     * 验证用户友好的错误提示
     */
    async validateUserFriendlyErrors() {
        const checks = [];
        
        // 检查错误处理器是否存在
        checks.push({
            name: '全局错误处理器',
            passed: typeof window.handleError === 'function',
            details: '检查全局错误处理机制'
        });

        // 检查消息显示功能
        checks.push({
            name: '消息显示功能',
            passed: typeof window.showMessage === 'function',
            details: '检查用户消息显示机制'
        });

        return {
            category: '用户友好错误',
            passed: checks.filter(c => c.passed).length,
            total: checks.length,
            checks: checks
        };
    }

    /**
     * 验证移动设备响应性
     */
    async validateMobileResponsiveness() {
        const checks = [];
        
        // 检查视口设置
        const viewport = document.querySelector('meta[name="viewport"]');
        checks.push({
            name: '视口元标签',
            passed: viewport && viewport.content.includes('width=device-width'),
            details: viewport ? viewport.content : '无视口设置'
        });

        return {
            category: '移动响应性',
            passed: checks.filter(c => c.passed).length,
            total: checks.length,
            checks: checks
        };
    }

    /**
     * 验证可访问性
     */
    async validateAccessibility() {
        const checks = [];
        
        // 检查按钮是否有适当的文本
        const buttons = document.querySelectorAll('button');
        const buttonsWithText = Array.from(buttons).filter(btn => 
            btn.textContent.trim().length > 0 || btn.getAttribute('aria-label')
        );
        
        checks.push({
            name: '按钮文本可访问性',
            passed: buttonsWithText.length === buttons.length,
            details: `${buttonsWithText.length}/${buttons.length} 按钮有文本`
        });

        return {
            category: '可访问性',
            passed: checks.filter(c => c.passed).length,
            total: checks.length,
            checks: checks
        };
    }

    /**
     * 验证易用性
     */
    async validateEaseOfUse() {
        const checks = [];
        
        // 检查是否有帮助信息
        const helpElements = document.querySelectorAll('[title], .help, .tooltip');
        checks.push({
            name: '帮助信息可用性',
            passed: helpElements.length > 0,
            details: `找到 ${helpElements.length} 个帮助元素`
        });

        return {
            category: '易用性',
            passed: checks.filter(c => c.passed).length,
            total: checks.length,
            checks: checks
        };
    }

    /**
     * 生成用户体验报告
     */
    generateUXReport(results) {
        let totalPassed = 0;
        let totalChecks = 0;
        const categories = [];

        Object.values(results).forEach(category => {
            totalPassed += category.passed;
            totalChecks += category.total;
            categories.push(category);
        });

        const successRate = totalChecks > 0 ? Math.round((totalPassed / totalChecks) * 100) : 0;

        return {
            summary: {
                totalChecks,
                passedChecks: totalPassed,
                failedChecks: totalChecks - totalPassed,
                successRate
            },
            categories,
            overallStatus: successRate >= 80 ? 'excellent' : successRate >= 60 ? 'good' : 'needs_improvement',
            recommendations: this.generateUXRecommendations(categories, successRate)
        };
    }

    /**
     * 生成用户体验建议
     */
    generateUXRecommendations(categories, successRate) {
        const recommendations = [];

        categories.forEach(category => {
            const failedChecks = category.checks.filter(c => !c.passed);
            if (failedChecks.length > 0) {
                recommendations.push({
                    category: category.category,
                    priority: failedChecks.length > category.total / 2 ? 'high' : 'medium',
                    issues: failedChecks.map(c => c.name),
                    suggestion: this.getCategorySuggestion(category.category)
                });
            }
        });

        if (successRate >= 80) {
            recommendations.push({
                category: '总体评价',
                priority: 'info',
                message: '用户体验良好，系统易于使用'
            });
        }

        return recommendations;
    }

    /**
     * 获取分类建议
     */
    getCategorySuggestion(category) {
        const suggestions = {
            '界面简洁性': '简化界面元素，减少不必要的按钮和信息',
            '用户友好错误': '完善错误处理机制，提供更友好的错误提示',
            '移动响应性': '优化移动设备显示，确保在小屏幕上的可用性',
            '可访问性': '添加必要的可访问性标签和描述',
            '易用性': '增加帮助信息和操作指导'
        };
        
        return suggestions[category] || '改进该方面的用户体验';
    }
}

// 导出类
window.UserExperienceValidator = UserExperienceValidator;