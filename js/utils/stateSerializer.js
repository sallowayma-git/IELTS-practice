/**
 * 状态序列化适配器
 * 解决Set/Map对象无法直接JSON序列化的问题
 */

class StateSerializer {
    /**
     * 序列化状态值，处理特殊对象类型
     */
    static serialize(value) {
        if (value === null || value === undefined) {
            return value;
        }

        // 处理Set对象
        if (value instanceof Set) {
            return {
                __type: 'Set',
                __value: Array.from(value)
            };
        }

        // 处理Map对象
        if (value instanceof Map) {
            return {
                __type: 'Map',
                __value: Array.from(value.entries())
            };
        }

        // 处理Date对象
        if (value instanceof Date) {
            return {
                __type: 'Date',
                __value: value.toISOString()
            };
        }

        // 处理普通对象，递归处理嵌套
        if (typeof value === 'object') {
            if (Array.isArray(value)) {
                return value.map(item => StateSerializer.serialize(item));
            } else {
                const serialized = {};
                for (const [key, val] of Object.entries(value)) {
                    serialized[key] = StateSerializer.serialize(val);
                }
                return serialized;
            }
        }

        // 基本类型直接返回
        return value;
    }

    /**
     * 反序列化状态值，恢复特殊对象类型
     */
    static deserialize(value) {
        if (value === null || value === undefined) {
            return value;
        }

        // 检查是否是特殊类型对象
        if (typeof value === 'object' && value !== null && '__type' in value) {
            switch (value.__type) {
                case 'Set':
                    return new Set(value.__value);
                case 'Map':
                    return new Map(value.__value);
                case 'Date':
                    return new Date(value.__value);
                default:
                    console.warn(`[StateSerializer] 未知类型: ${value.__type}`);
                    return value.__value;
            }
        }

        // 处理数组
        if (Array.isArray(value)) {
            return value.map(item => StateSerializer.deserialize(item));
        }

        // 处理普通对象，递归处理嵌套
        if (typeof value === 'object') {
            const deserialized = {};
            for (const [key, val] of Object.entries(value)) {
                deserialized[key] = StateSerializer.deserialize(val);
            }
            return deserialized;
        }

        // 基本类型直接返回
        return value;
    }

    /**
     * 验证序列化/反序列化的一致性
     */
    static validate(originalValue) {
        try {
            const serialized = StateSerializer.serialize(originalValue);
            const deserialized = StateSerializer.deserialize(serialized);

            // 对于Set/Map，深度比较内容
            if (originalValue instanceof Set) {
                const originalArray = Array.from(originalValue);
                const deserializedArray = Array.from(deserialized);
                return JSON.stringify(originalArray.sort()) === JSON.stringify(deserializedArray.sort());
            }

            if (originalValue instanceof Map) {
                const originalArray = Array.from(originalValue.entries()).sort();
                const deserializedArray = Array.from(deserialized.entries()).sort();
                return JSON.stringify(originalArray) === JSON.stringify(deserializedArray);
            }

            // 其他类型直接比较
            return JSON.stringify(originalValue) === JSON.stringify(deserialized);
        } catch (error) {
            console.error('[StateSerializer] 验证失败:', error);
            return false;
        }
    }

    /**
     * 创建存储适配器，包装storage对象
     */
    static createStorageAdapter(baseStorage) {
        return {
            async get(key, defaultValue = null) {
                try {
                    const value = await baseStorage.get(key, defaultValue);
                    return StateSerializer.deserialize(value);
                } catch (error) {
                    console.error(`[StateSerializer] 获取数据失败 ${key}:`, error);
                    return defaultValue;
                }
            },

            async set(key, value) {
                try {
                    const serializedValue = StateSerializer.serialize(value);
                    return await baseStorage.set(key, serializedValue);
                } catch (error) {
                    console.error(`[StateSerializer] 设置数据失败 ${key}:`, error);
                    throw error;
                }
            },

            async remove(key) {
                try {
                    return await baseStorage.remove(key);
                } catch (error) {
                    console.error(`[StateSerializer] 删除数据失败 ${key}:`, error);
                    throw error;
                }
            },

            async clear() {
                try {
                    return await baseStorage.clear();
                } catch (error) {
                    console.error('[StateSerializer] 清空存储失败:', error);
                    throw error;
                }
            }
        };
    }
}

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateSerializer;
}