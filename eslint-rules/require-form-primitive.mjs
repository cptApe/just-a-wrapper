// require-form-primitive — keeps every committed value on the one Form, so Cmd+Enter works app-wide.

const TEXT_FIELDS = new Set(['input', 'textarea', 'Input', 'Textarea']);

function jsxName(node) {
  return node.name.type === 'JSXIdentifier' ? node.name.name : null;
}

// A search box filters a list as the person types; it commits nothing.
function isCommittedTextField(node, name) {
  if (name !== 'Textarea' && name !== 'Input' && name !== 'textarea') return false;
  return !node.attributes.some(
    (attribute) =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.name === 'type' &&
      attribute.value?.value === 'search',
  );
}

function isEnterComparison(node) {
  const { left, right, operator } = node;
  if (!['===', '==', '!==', '!='].includes(operator)) return false;
  return (
    left.type === 'MemberExpression' &&
    left.property.type === 'Identifier' &&
    left.property.name === 'key' &&
    right.type === 'Literal' &&
    right.value === 'Enter'
  );
}

function isModifierRead(node) {
  return (
    node.property.type === 'Identifier' &&
    (node.property.name === 'metaKey' || node.property.name === 'ctrlKey')
  );
}

function isFormSubmitCall(node) {
  const callee = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee;
  return (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'requestSubmit' &&
    callee.object.type === 'MemberExpression' &&
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === 'form'
  );
}

function isFieldKeyHandler(attribute) {
  return (
    attribute.name.type === 'JSXIdentifier' &&
    attribute.name.name === 'onKeyDown' &&
    attribute.parent.type === 'JSXOpeningElement' &&
    TEXT_FIELDS.has(jsxName(attribute.parent))
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Requires the shared Form for submit behaviour: no raw form element, hand-written Cmd+Enter, Enter commit on a text field, or modal that collects text without a Form.',
    },
    messages: {
      rawForm: 'Use Form from @/components/ui/form so Cmd+Enter saves this form.',
      formSubmitCall:
        'Do not call form.requestSubmit() directly. Form from @/components/ui/form owns keyboard submit.',
      modEnterHandler:
        'Do not hand-write Cmd+Enter. Wrap the fields in Form from @/components/ui/form and make Save a submit button.',
      enterKeyCommit:
        'Commit text through onSubmit on Form from @/components/ui/form, not an Enter key handler on the field.',
      modalWithoutForm:
        'A modal with a text field needs Form from @/components/ui/form around its content and footer.',
    },
    schema: [],
  },

  create(context) {
    const functions = [];
    const fieldHandlers = [];
    const modalFooters = [];
    let hasTextField = false;
    let hasForm = false;

    function enterFunction() {
      functions.push({ enterNodes: [], modifierRead: false });
    }

    function exitFunction() {
      const scope = functions.pop();
      if (scope?.modifierRead) {
        for (const node of scope.enterNodes) {
          context.report({ node, messageId: 'modEnterHandler' });
        }
      }
    }

    return {
      FunctionDeclaration: enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      FunctionExpression: enterFunction,
      'FunctionExpression:exit': exitFunction,
      ArrowFunctionExpression: enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,

      JSXOpeningElement(node) {
        const name = jsxName(node);
        if (name === 'form') context.report({ node, messageId: 'rawForm' });
        if (name === 'Form') hasForm = true;
        if (name === 'ModalFooter') modalFooters.push(node);
        if (isCommittedTextField(node, name)) hasTextField = true;
      },

      JSXAttribute(node) {
        if (isFieldKeyHandler(node)) fieldHandlers.push(node);
      },

      BinaryExpression(node) {
        if (!isEnterComparison(node)) return;
        functions.at(-1)?.enterNodes.push(node);
        const handler = fieldHandlers.find(
          (attribute) => attribute.range[0] <= node.range[0] && node.range[1] <= attribute.range[1],
        );
        if (handler) context.report({ node, messageId: 'enterKeyCommit' });
      },

      MemberExpression(node) {
        const scope = functions.at(-1);
        if (scope && isModifierRead(node)) scope.modifierRead = true;
      },

      CallExpression(node) {
        if (isFormSubmitCall(node)) context.report({ node, messageId: 'formSubmitCall' });
      },

      'Program:exit'() {
        if (!hasTextField || hasForm) return;
        for (const node of modalFooters) {
          context.report({ node, messageId: 'modalWithoutForm' });
        }
      },
    };
  },
};

export default rule;
