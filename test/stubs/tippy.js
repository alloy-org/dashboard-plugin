function mockElement() {
  return { addEventListener() {}, removeEventListener() {}, classList: { toggle() {} }, firstElementChild: null };
}

function tippy() {
  return {
    destroy() {}, show() {}, hide() {}, setContent() {}, setProps() {},
    popper: mockElement(),
    popperInstance: { update() {} },
    state: { isVisible: false },
    props: { placement: 'top' },
  };
}
tippy.default = tippy;
export default tippy;
