<template>
  <div class="editor-toolbar">
    <el-button-group>
      <el-tooltip content="加粗" placement="top">
        <el-button :type="getActiveType('bold')" @click="toggle('bold')" size="small">
          <strong>B</strong>
        </el-button>
      </el-tooltip>
      <el-tooltip content="斜体" placement="top">
        <el-button :type="getActiveType('italic')" @click="toggle('italic')" size="small">
          <em>I</em>
        </el-button>
      </el-tooltip>
      <el-tooltip content="下划线" placement="top">
        <el-button :type="getActiveType('underline')" @click="toggle('underline')" size="small">
          <span class="toolbar-underline">U</span>
        </el-button>
      </el-tooltip>
      <el-tooltip content="高亮" placement="top">
        <el-button :type="getActiveType('highlight')" @click="toggle('highlight')" size="small">
          <span class="toolbar-highlight">H</span>
        </el-button>
      </el-tooltip>
    </el-button-group>

    <el-divider direction="vertical" />

    <el-button-group>
      <el-tooltip content="无序列表" placement="top">
        <el-button :type="getActiveType('bulletList')" @click="toggleList('bulletList')" size="small">
          • List
        </el-button>
      </el-tooltip>
      <el-tooltip content="有序列表" placement="top">
        <el-button :type="getActiveType('orderedList')" @click="toggleList('orderedList')" size="small">
          1. List
        </el-button>
      </el-tooltip>
    </el-button-group>

    <el-divider direction="vertical" />

    <el-button-group>
      <el-button size="small" @click="editor.chain().focus().undo().run()" :disabled="!editor.can().undo()">
        撤销
      </el-button>
      <el-button size="small" @click="editor.chain().focus().redo().run()" :disabled="!editor.can().redo()">
        重做
      </el-button>
    </el-button-group>
  </div>
</template>

<script setup>
const props = defineProps({
  editor: {
    type: Object,
    required: true
  }
})

const toggle = (action) => {
  props.editor.chain().focus()[`toggle${capitalize(action)}`]().run()
}

const toggleList = (action) => {
  props.editor.chain().focus()[`toggle${capitalize(action)}`]().run()
}

const getActiveType = (action) => {
  return props.editor.isActive(action) ? 'primary' : 'default'
}

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1)
</script>

<style scoped>
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.toolbar-underline {
  text-decoration: underline;
}

.toolbar-highlight {
  background: #ffe58f;
  padding: 0 4px;
}
</style>
